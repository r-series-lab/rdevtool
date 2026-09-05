#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args = std::env::args_os().collect::<Vec<_>>();
    if let Some(result) = rdevtool_core::proxy_daemon::run_proxy_daemon_from_args(&args) {
        if let Err(error) = result {
            eprintln!("proxy daemon failed: {error:#}");
            std::process::exit(1);
        }
        return;
    }
    if let Some(result) = rdevtool_core::runtime_daemon::run_runtime_daemon_from_args(&args) {
        if let Err(error) = result {
            eprintln!("runtime daemon failed: {error:#}");
            std::process::exit(1);
        }
        return;
    }
    rdevtool_tauri::run();
}
