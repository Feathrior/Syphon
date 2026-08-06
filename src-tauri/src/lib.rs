#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Windows 11:为窗口应用 Mica(云母)背景,配合工具栏半透明 CSS 显示
            #[cfg(target_os = "windows")]
            {
                use tauri::window::Effect;
                use tauri::{utils::config::WindowEffectsConfig, Manager};
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_effects(WindowEffectsConfig {
                        effects: vec![Effect::MicaDark],
                        state: None,
                        radius: None,
                        color: None,
                    });
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
