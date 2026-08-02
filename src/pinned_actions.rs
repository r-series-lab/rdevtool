use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::navigation::NavigationEntry;
use crate::operation::OperationChainContext;
use crate::storage::Storage;

pub const TRAY_STORAGE_NAMESPACE: &str = "tray";
pub const TRAY_PINNED_STORAGE_KEY: &str = "pinned-actions";
pub const TRAY_PINNED_STORAGE_LIMIT: usize = 60;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayReplayAction {
    pub kind: String,
    pub label: String,
    pub detail: Option<String>,
    #[serde(default)]
    pub workspace_key: Option<String>,
    pub project_key: Option<String>,
    pub entry: Option<NavigationEntry>,
    #[serde(default)]
    pub payload: Option<Value>,
    #[serde(default, skip_serializing)]
    pub execution_context: Option<OperationChainContext>,
    pub dedupe_key: String,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayPinnedActionsMutation {
    pub actions: Vec<TrayReplayAction>,
    pub changed: bool,
    pub pinned: Option<bool>,
    pub dedupe_keys: Vec<String>,
}

pub fn valid_tray_action(action: &TrayReplayAction) -> bool {
    !action.kind.trim().is_empty()
        && !action.label.trim().is_empty()
        && !action.dedupe_key.trim().is_empty()
}

fn same_actions(left: &[TrayReplayAction], right: &[TrayReplayAction]) -> bool {
    serde_json::to_value(left).ok() == serde_json::to_value(right).ok()
}

pub fn normalize_tray_pinned_actions(
    actions: impl IntoIterator<Item = TrayReplayAction>,
    now_ms: u64,
) -> Vec<TrayReplayAction> {
    let mut normalized = Vec::new();
    for mut action in actions {
        action.kind = action.kind.trim().to_string();
        action.label = action.label.trim().to_string();
        action.dedupe_key = action.dedupe_key.trim().to_string();
        if !valid_tray_action(&action) {
            continue;
        }
        action.workspace_key = action
            .workspace_key
            .take()
            .map(|workspace_key| workspace_key.trim().to_string())
            .filter(|workspace_key| !workspace_key.is_empty());
        if action.updated_at_ms == 0 {
            action.updated_at_ms = now_ms;
        }
        if normalized
            .iter()
            .any(|item: &TrayReplayAction| item.dedupe_key == action.dedupe_key)
        {
            continue;
        }
        normalized.push(action);
        if normalized.len() >= TRAY_PINNED_STORAGE_LIMIT {
            break;
        }
    }
    normalized
}

pub fn list_tray_pinned_actions(storage: &Storage) -> Result<Vec<TrayReplayAction>, String> {
    let actions = storage
        .get_json(TRAY_STORAGE_NAMESPACE, TRAY_PINNED_STORAGE_KEY)?
        .and_then(|value| serde_json::from_value::<Vec<TrayReplayAction>>(value).ok())
        .unwrap_or_default();
    Ok(normalize_tray_pinned_actions(actions, 0))
}

pub fn replace_tray_pinned_actions(
    storage: &Storage,
    actions: Vec<TrayReplayAction>,
    now_ms: u64,
) -> Result<TrayPinnedActionsMutation, String> {
    let normalized = normalize_tray_pinned_actions(actions, now_ms);
    let mut changed = false;
    let value = storage.update_json(TRAY_STORAGE_NAMESPACE, TRAY_PINNED_STORAGE_KEY, |stored| {
        let current = stored
            .and_then(|value| serde_json::from_value::<Vec<TrayReplayAction>>(value).ok())
            .map(|actions| normalize_tray_pinned_actions(actions, now_ms))
            .unwrap_or_default();
        changed = !same_actions(&current, &normalized);
        serde_json::to_value(&normalized).map_err(|error| error.to_string())
    })?;
    let actions = serde_json::from_value(value).map_err(|error| error.to_string())?;
    Ok(TrayPinnedActionsMutation {
        actions,
        changed,
        pinned: None,
        dedupe_keys: Vec::new(),
    })
}

pub fn upsert_tray_pinned_action(
    storage: &Storage,
    action: TrayReplayAction,
    now_ms: u64,
) -> Result<TrayPinnedActionsMutation, String> {
    let Some(action) = normalize_tray_pinned_actions([action], now_ms)
        .into_iter()
        .next()
    else {
        return Err("标记动作缺少 kind、label 或 dedupeKey".to_string());
    };
    let dedupe_key = action.dedupe_key.clone();
    let mut changed = false;
    let value = storage.update_json(TRAY_STORAGE_NAMESPACE, TRAY_PINNED_STORAGE_KEY, |stored| {
        let current = stored
            .and_then(|value| serde_json::from_value::<Vec<TrayReplayAction>>(value).ok())
            .map(|actions| normalize_tray_pinned_actions(actions, now_ms))
            .unwrap_or_default();
        let mut next = vec![action.clone()];
        next.extend(
            current
                .iter()
                .filter(|item| item.dedupe_key != dedupe_key)
                .cloned(),
        );
        next.truncate(TRAY_PINNED_STORAGE_LIMIT);
        changed = !same_actions(&next, &current);
        serde_json::to_value(next).map_err(|error| error.to_string())
    })?;
    let actions = serde_json::from_value(value).map_err(|error| error.to_string())?;
    Ok(TrayPinnedActionsMutation {
        actions,
        changed,
        pinned: Some(true),
        dedupe_keys: vec![dedupe_key],
    })
}

pub fn remove_tray_pinned_actions(
    storage: &Storage,
    dedupe_keys: Vec<String>,
    now_ms: u64,
) -> Result<TrayPinnedActionsMutation, String> {
    let dedupe_keys = dedupe_keys
        .into_iter()
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
        .collect::<std::collections::BTreeSet<_>>();
    if dedupe_keys.is_empty() {
        return Ok(TrayPinnedActionsMutation {
            actions: list_tray_pinned_actions(storage)?,
            changed: false,
            pinned: Some(false),
            dedupe_keys: Vec::new(),
        });
    }
    let mut changed = false;
    let value = storage.update_json(TRAY_STORAGE_NAMESPACE, TRAY_PINNED_STORAGE_KEY, |stored| {
        let current = stored
            .and_then(|value| serde_json::from_value::<Vec<TrayReplayAction>>(value).ok())
            .map(|actions| normalize_tray_pinned_actions(actions, now_ms))
            .unwrap_or_default();
        let next = current
            .iter()
            .filter(|item| !dedupe_keys.contains(&item.dedupe_key))
            .cloned()
            .collect::<Vec<_>>();
        changed = !same_actions(&next, &current);
        serde_json::to_value(next).map_err(|error| error.to_string())
    })?;
    let actions = serde_json::from_value(value).map_err(|error| error.to_string())?;
    Ok(TrayPinnedActionsMutation {
        actions,
        changed,
        pinned: Some(false),
        dedupe_keys: dedupe_keys.into_iter().collect(),
    })
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};

    use super::{
        TrayReplayAction, list_tray_pinned_actions, normalize_tray_pinned_actions,
        remove_tray_pinned_actions, replace_tray_pinned_actions, upsert_tray_pinned_action,
    };
    use crate::operation::OperationChainContext;
    use crate::storage::Storage;

    fn storage(name: &str) -> (Storage, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "rdevtool-pinned-actions-{name}-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        (Storage::new(path.clone()).unwrap(), path)
    }

    fn action(key: &str, label: &str) -> TrayReplayAction {
        TrayReplayAction {
            kind: "build.replay".to_string(),
            label: label.to_string(),
            detail: None,
            workspace_key: Some(" feature-a ".to_string()),
            project_key: Some("admin".to_string()),
            entry: None,
            payload: None,
            execution_context: None,
            dedupe_key: key.to_string(),
            updated_at_ms: 0,
        }
    }

    #[test]
    fn normalizes_and_deduplicates_actions() {
        let actions = normalize_tray_pinned_actions(
            [
                action(" build:a ", " First "),
                action("build:a", "Duplicate"),
                action("", "Invalid"),
            ],
            42,
        );

        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].dedupe_key, "build:a");
        assert_eq!(actions[0].label, "First");
        assert_eq!(actions[0].workspace_key.as_deref(), Some("feature-a"));
        assert_eq!(actions[0].updated_at_ms, 42);
    }

    #[test]
    fn execution_context_is_never_persisted_with_a_pinned_action() {
        let mut value = action("build:a", "Build A");
        value.execution_context = Some(OperationChainContext {
            chain_id: Some("workspace-chain:delivery:run-1".to_string()),
            step_label: Some("构建".to_string()),
            ..OperationChainContext::default()
        });

        let serialized = serde_json::to_value(value).expect("serialize pinned action");

        assert!(serialized.get("executionContext").is_none());
    }

    #[test]
    fn upsert_and_remove_preserve_unrelated_actions() {
        let (storage, path) = storage("preserve");
        replace_tray_pinned_actions(
            &storage,
            vec![action("build:a", "A"), action("build:b", "B")],
            10,
        )
        .unwrap();
        upsert_tray_pinned_action(&storage, action("build:a", "A2"), 20).unwrap();
        remove_tray_pinned_actions(&storage, vec!["build:b".to_string()], 30).unwrap();

        let actions = list_tray_pinned_actions(&storage).unwrap();
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].label, "A2");
        assert_eq!(actions[0].dedupe_key, "build:a");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn concurrent_upserts_do_not_overwrite_each_other() {
        let (storage, path) = storage("concurrent");
        let barrier = Arc::new(Barrier::new(3));
        let handles = ["build:a", "build:b"]
            .into_iter()
            .map(|key| {
                let storage = storage.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    upsert_tray_pinned_action(&storage, action(key, key), 10).unwrap();
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        for handle in handles {
            handle.join().unwrap();
        }

        let mut keys = list_tray_pinned_actions(&storage)
            .unwrap()
            .into_iter()
            .map(|item| item.dedupe_key)
            .collect::<Vec<_>>();
        keys.sort();
        assert_eq!(keys, vec!["build:a", "build:b"]);
        let _ = std::fs::remove_file(path);
    }
}
