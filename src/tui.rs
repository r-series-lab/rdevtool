use anyhow::{Context, Result};
use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use crossterm::execute;
use crossterm::terminal::{
    EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
};
use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, ListState, Paragraph, Wrap};
use rdevtool_core::config::{AppConfig, ProjectConfig};
use rdevtool_core::core::{DeployPlan, DeployRequest, build_plan};
use rdevtool_core::credentials;
use rdevtool_core::jenkins;
use std::collections::BTreeMap;
use std::io::{self, Stdout};
use std::time::Duration;

pub fn run(config: &AppConfig) -> Result<()> {
    let mut terminal = setup_terminal()?;
    let result = run_app(&mut terminal, config);
    restore_terminal(&mut terminal)?;
    result
}

fn setup_terminal() -> Result<Terminal<CrosstermBackend<Stdout>>> {
    enable_raw_mode().context("failed to enable raw mode")?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen).context("failed to enter alternate screen")?;
    let backend = CrosstermBackend::new(stdout);
    Terminal::new(backend).context("failed to create terminal")
}

fn restore_terminal(terminal: &mut Terminal<CrosstermBackend<Stdout>>) -> Result<()> {
    disable_raw_mode().context("failed to disable raw mode")?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)
        .context("failed to leave alternate screen")?;
    terminal.show_cursor().context("failed to show cursor")?;
    Ok(())
}

fn run_app(terminal: &mut Terminal<CrosstermBackend<Stdout>>, config: &AppConfig) -> Result<()> {
    let mut app = App::new(config);
    loop {
        terminal
            .draw(|frame| draw(frame, &app, config))
            .context("failed to draw TUI")?;

        if event::poll(Duration::from_millis(150)).context("failed to poll terminal event")? {
            let Event::Key(key) = event::read().context("failed to read terminal event")? else {
                continue;
            };
            if key.kind != KeyEventKind::Press {
                continue;
            }

            if app.handle_key(key.code, config)? {
                break;
            }
        }
    }

    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EditField {
    Env,
    Branch,
}

#[derive(Debug)]
struct App {
    selected: usize,
    list_state: ListState,
    status: String,
    env_overrides: BTreeMap<String, String>,
    branch_overrides: BTreeMap<String, String>,
    variant_overrides: BTreeMap<String, bool>,
    edit_mode: Option<EditMode>,
}

#[derive(Debug)]
struct EditMode {
    field: EditField,
    buffer: String,
}

impl App {
    fn new(config: &AppConfig) -> Self {
        let mut list_state = ListState::default();
        if !config.projects.is_empty() {
            list_state.select(Some(0));
        }

        Self {
            selected: 0,
            list_state,
            status: "ready: ↑/↓ select, v toggle variant, e edit env, b edit branch, t trigger, q quit"
                .to_string(),
            env_overrides: BTreeMap::new(),
            branch_overrides: BTreeMap::new(),
            variant_overrides: BTreeMap::new(),
            edit_mode: None,
        }
    }

    fn selected_project<'a>(&self, config: &'a AppConfig) -> &'a ProjectConfig {
        &config.projects[self.selected]
    }

    fn selected_project_key<'a>(&self, config: &'a AppConfig) -> &'a str {
        self.selected_project(config).key.as_str()
    }

    fn uses_variant(&self, config: &AppConfig) -> bool {
        self.variant_overrides
            .get(self.selected_project_key(config))
            .copied()
            .unwrap_or(false)
    }

    fn env_override(&self, config: &AppConfig) -> Option<String> {
        self.env_overrides
            .get(self.selected_project_key(config))
            .cloned()
            .filter(|value| !value.is_empty())
    }

    fn branch_override(&self, config: &AppConfig) -> Option<String> {
        self.branch_overrides
            .get(self.selected_project_key(config))
            .cloned()
            .filter(|value| !value.is_empty())
    }

    fn current_plan(&self, config: &AppConfig) -> Result<DeployPlan> {
        build_plan(
            config,
            &DeployRequest {
                project: self.selected_project_key(config).to_string(),
                target: None,
                variant: self.uses_variant(config),
                env: self.env_override(config),
                branch: self.branch_override(config),
                extra_params: Default::default(),
                params: Default::default(),
            },
        )
    }

    fn start_edit(&mut self, field: EditField, config: &AppConfig) {
        let buffer = match field {
            EditField::Env => self.env_override(config).unwrap_or_default(),
            EditField::Branch => self.branch_override(config).unwrap_or_else(|| {
                self.current_plan(config)
                    .ok()
                    .and_then(|plan| {
                        plan.params
                            .iter()
                            .find(|(key, _)| matches!(key.as_str(), "BRANCH" | "branch" | "Branch"))
                            .map(|(_, value)| value.clone())
                    })
                    .unwrap_or_default()
            }),
        };
        self.edit_mode = Some(EditMode { field, buffer });
    }

    fn set_status(&mut self, message: impl Into<String>) {
        self.status = message.into();
    }

    fn move_selection(&mut self, delta: isize, config: &AppConfig) {
        let count = config.projects.len() as isize;
        let next = (self.selected as isize + delta).clamp(0, count.saturating_sub(1));
        self.selected = next as usize;
        self.list_state.select(Some(self.selected));
    }

    fn handle_key(&mut self, code: KeyCode, config: &AppConfig) -> Result<bool> {
        if self.edit_mode.is_some() {
            return self.handle_edit_key(code, config);
        }

        match code {
            KeyCode::Char('q') => return Ok(true),
            KeyCode::Down | KeyCode::Char('j') => self.move_selection(1, config),
            KeyCode::Up | KeyCode::Char('k') => self.move_selection(-1, config),
            KeyCode::Char('v') => self.toggle_variant(config),
            KeyCode::Char('e') => self.start_edit(EditField::Env, config),
            KeyCode::Char('b') => self.start_edit(EditField::Branch, config),
            KeyCode::Char('r') => self.refresh_branch(config),
            KeyCode::Char('t') => self.trigger(config)?,
            _ => {}
        }
        Ok(false)
    }

    fn handle_edit_key(&mut self, code: KeyCode, config: &AppConfig) -> Result<bool> {
        let Some(edit_mode) = self.edit_mode.as_mut() else {
            return Ok(false);
        };

        match code {
            KeyCode::Esc => {
                self.edit_mode = None;
                self.set_status("edit cancelled");
            }
            KeyCode::Enter => {
                let field = edit_mode.field;
                let value = edit_mode.buffer.trim().to_string();
                self.edit_mode = None;
                let key = self.selected_project_key(config).to_string();
                match field {
                    EditField::Env => upsert_or_remove(&mut self.env_overrides, key, value),
                    EditField::Branch => upsert_or_remove(&mut self.branch_overrides, key, value),
                }
                self.set_status("override updated");
            }
            KeyCode::Backspace => {
                edit_mode.buffer.pop();
            }
            KeyCode::Char(ch) => {
                edit_mode.buffer.push(ch);
            }
            _ => {}
        }
        Ok(false)
    }

    fn toggle_variant(&mut self, config: &AppConfig) {
        let project = self.selected_project(config);
        if project.jobs.variant.is_none() {
            self.set_status("this project has no variant job");
            return;
        }
        let key = project.key.clone();
        let next = !self.uses_variant(config);
        self.variant_overrides.insert(key, next);
        self.set_status(format!(
            "job mode switched to {}",
            if next { "variant" } else { "standard" }
        ));
    }

    fn refresh_branch(&mut self, config: &AppConfig) {
        let key = self.selected_project_key(config).to_string();
        self.branch_overrides.remove(&key);
        self.set_status("branch override cleared; using local repo branch when available");
    }

    fn trigger(&mut self, config: &AppConfig) -> Result<()> {
        let plan = match self.current_plan(config) {
            Ok(plan) => plan,
            Err(error) => {
                self.set_status(format!("plan error: {error}"));
                return Ok(());
            }
        };

        let password = match credentials::load_jenkins_password(&config.defaults) {
            Ok(password) => password,
            Err(error) => {
                self.set_status(format!("credentials error: {error}"));
                return Ok(());
            }
        };

        match jenkins::trigger_build(
            &config.defaults.jenkins_base_url,
            &config.defaults.jenkins_username,
            &password,
            &plan.trigger_url,
            &plan.params,
        ) {
            Ok(result) => {
                let queue = result.queue_url.unwrap_or_else(|| "<none>".to_string());
                self.set_status(format!(
                    "triggered: HTTP {} | queue {}",
                    result.status, queue
                ));
            }
            Err(error) => {
                self.set_status(format!("trigger failed: {error}"));
            }
        }

        Ok(())
    }
}

fn upsert_or_remove(map: &mut BTreeMap<String, String>, key: String, value: String) {
    if value.is_empty() {
        map.remove(&key);
    } else {
        map.insert(key, value);
    }
}

fn draw(frame: &mut ratatui::Frame<'_>, app: &App, config: &AppConfig) {
    let root = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(10),
            Constraint::Length(3),
            Constraint::Length(if app.edit_mode.is_some() { 3 } else { 0 }),
        ])
        .split(frame.area());

    let body = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(32), Constraint::Percentage(68)])
        .split(root[0]);

    let items = config
        .projects
        .iter()
        .map(|project| {
            let line = format!("{}  {}", project.key, project.name);
            ListItem::new(line)
        })
        .collect::<Vec<_>>();

    let list = List::new(items)
        .block(Block::default().title("Projects").borders(Borders::ALL))
        .highlight_style(
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol(">> ");
    frame.render_stateful_widget(list, body[0], &mut app.list_state.clone());

    let selected_project = app.selected_project(config);
    let details = project_details(app, config, selected_project);
    let detail_block = Paragraph::new(details)
        .block(Block::default().title("Deploy Plan").borders(Borders::ALL))
        .wrap(Wrap { trim: false });
    frame.render_widget(detail_block, body[1]);

    let footer = Paragraph::new(Text::from(vec![
        Line::from(vec![
            Span::styled("Keys  ", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw("↑/↓ or j/k select   v toggle variant   e edit env   b edit branch   r reset branch   t trigger   q quit"),
        ]),
        Line::from(Span::styled(
            app.status.as_str(),
            Style::default().fg(Color::Cyan),
        )),
    ]))
    .block(Block::default().title("Status").borders(Borders::ALL))
    .wrap(Wrap { trim: false });
    frame.render_widget(footer, root[1]);

    if let Some(edit) = &app.edit_mode {
        let title = match edit.field {
            EditField::Env => "Edit Env",
            EditField::Branch => "Edit Branch",
        };
        let popup = centered_rect(72, 3, frame.area());
        frame.render_widget(Clear, popup);
        let widget = Paragraph::new(edit.buffer.as_str())
            .block(
                Block::default()
                    .title(format!("{title}  (Enter save / Esc cancel)"))
                    .borders(Borders::ALL),
            )
            .wrap(Wrap { trim: false });
        frame.render_widget(widget, popup);
    }
}

fn project_details(app: &App, config: &AppConfig, project: &ProjectConfig) -> Text<'static> {
    let repo_path = project
        .repo_path
        .as_ref()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| "<unconfigured>".to_string());
    let env_override = app
        .env_override(config)
        .unwrap_or_else(|| "<default>".to_string());
    let branch_override = app
        .branch_override(config)
        .unwrap_or_else(|| "<auto>".to_string());

    let mut lines = vec![
        Line::from(vec![
            Span::styled("Project: ", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(project.name.clone()),
        ]),
        Line::from(format!("Key: {}", project.key)),
        Line::from(format!("Git: {}", project.git_url)),
        Line::from(format!("Repo: {}", repo_path)),
        Line::from(format!(
            "Mode: {}",
            if app.uses_variant(config) {
                "variant"
            } else {
                "standard"
            }
        )),
        Line::from(format!("Env override: {}", env_override)),
        Line::from(format!("Branch override: {}", branch_override)),
        Line::from(""),
    ];

    match app.current_plan(config) {
        Ok(plan) => {
            lines.push(Line::from(vec![
                Span::styled(
                    "Jenkins Job: ",
                    Style::default().add_modifier(Modifier::BOLD),
                ),
                Span::raw(plan.job_name),
            ]));
            lines.push(Line::from(format!("Trigger: {}", plan.trigger_url)));
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "Parameters",
                Style::default().add_modifier(Modifier::BOLD),
            )));
            for (key, value) in plan.params {
                lines.push(Line::from(format!("  {key} = {value}")));
            }
        }
        Err(error) => {
            lines.push(Line::from(Span::styled(
                "Plan error",
                Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
            )));
            lines.push(Line::from(error.to_string()));
        }
    }

    Text::from(lines)
}

fn centered_rect(
    percent_x: u16,
    height: u16,
    area: ratatui::layout::Rect,
) -> ratatui::layout::Rect {
    let vertical = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Fill(1),
            Constraint::Length(height),
            Constraint::Fill(1),
        ])
        .split(area);
    let horizontal = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(vertical[1]);
    horizontal[1]
}
