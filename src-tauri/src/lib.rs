#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Windows 11:为窗口应用 Mica(云母)背景,配合工具栏半透明 CSS 显示
            #[cfg(target_os = "windows")]
            {
                use std::sync::atomic::{AtomicU64, Ordering};
                use std::sync::Arc;
                use std::thread;
                use std::time::Duration;
                use tauri::window::Effect;
                use tauri::{utils::config::WindowEffectsConfig, Manager, WindowEvent};

                if let Some(window) = app.get_webview_window("main") {
                    // 初始应用 Mica 效果
                    let mica_config = WindowEffectsConfig {
                        effects: vec![Effect::MicaDark],
                        state: None,
                        radius: None,
                        color: None,
                    };
                    let _ = window.set_effects(mica_config.clone());

                    // 窗口缩放期间临时移除 Mica 效果,减少 DWM 合成开销;
                    // 缩放停止 200ms 后恢复。解决拖拽窗口边框缩放时不跟手的问题。
                    let win = window.clone();
                    let last_resize: Arc<AtomicU64> = Arc::new(AtomicU64::new(0));
                    let _last_for_closure = last_resize.clone();
                    window.on_window_event(move |event| {
                        if let WindowEvent::Resized(_) = event {
                            let now = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .map(|d| d.as_millis() as u64)
                                .unwrap_or(0);
                            _last_for_closure.store(now, Ordering::Relaxed);

                            // 移除 Mica(减少 GPU 纹理处理),窗口背景由前端 CSS 兜底为不透明色
                            let _ = win.set_effects(WindowEffectsConfig {
                                effects: vec![],
                                state: None,
                                radius: None,
                                color: None,
                            });

                            // 启动防抖线程:200ms 后若仍无新 resize 事件则恢复 Mica
                            let w = win.clone();
                            let lr = _last_for_closure.clone();
                            thread::spawn(move || {
                                thread::sleep(Duration::from_millis(200));
                                let last = lr.load(Ordering::Relaxed);
                                let now = std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .map(|d| d.as_millis() as u64)
                                    .unwrap_or(0);
                                if now - last >= 200 {
                                    let _ = w.set_effects(WindowEffectsConfig {
                                        effects: vec![Effect::MicaDark],
                                        state: None,
                                        radius: None,
                                        color: None,
                                    });
                                }
                            });
                        }
                    });
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
