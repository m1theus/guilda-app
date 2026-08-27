mod api;
mod media;
mod screen_capture;
mod token_store;
mod window;

use api::{publish_native_event, NativeError, NativeEvent, NativeEventState, TrayAction};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;

fn publish_integration_error<R: Runtime>(
    app: &AppHandle<R>,
    integration: &str,
    error: NativeError,
) {
    eprintln!(
        "{integration} integration failed ({}): {}",
        error.code, error.message
    );
    publish_native_event(
        app,
        NativeEvent::IntegrationError {
            integration: integration.to_owned(),
            code: error.code,
            message: error.message,
        },
    );
}

fn is_valid_invite_code(code: &str) -> bool {
    (4..=100).contains(&code.len())
        && code
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn parse_invite_url(url: &Url) -> Result<NativeEvent, NativeError> {
    if url.scheme() != "guilda" || url.host_str() != Some("invite") {
        return Err(NativeError::new(
            "invalid_deep_link",
            "expected a guilda://invite/<code> URL",
        ));
    }

    let mut segments = url
        .path_segments()
        .ok_or_else(|| NativeError::new("invalid_deep_link", "invite URL has no path"))?;
    let code = segments
        .next()
        .filter(|segment| !segment.is_empty())
        .ok_or_else(|| NativeError::new("invalid_deep_link", "invite URL has no code"))?;
    if segments.next().is_some() || !is_valid_invite_code(code) {
        return Err(NativeError::new(
            "invalid_deep_link",
            "invite URL must contain exactly one valid code segment",
        ));
    }

    Ok(NativeEvent::InviteDeepLink {
        code: code.to_owned(),
    })
}

fn publish_invite_url(app: &AppHandle, url: &Url) {
    match parse_invite_url(url) {
        Ok(event) => {
            publish_native_event(app, event);
            if let Err(error) = window::window_show(app.clone()) {
                publish_integration_error(app, "deepLink", error);
            }
        }
        Err(error) => {
            eprintln!("ignoring invalid deep link: {}", error.message);
        }
    }
}

fn build_tray(app: &tauri::App) -> Result<(), tauri::Error> {
    let show = MenuItem::with_id(app, "show", "Show Guilda", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide Guilda", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Guilda", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("Guilda")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => match window::window_show(app.clone()) {
                Ok(()) => publish_native_event(
                    app,
                    NativeEvent::Tray {
                        action: TrayAction::Show,
                    },
                ),
                Err(error) => publish_integration_error(app, "tray", error),
            },
            "hide" => match window::window_hide(app.clone()) {
                Ok(()) => publish_native_event(
                    app,
                    NativeEvent::Tray {
                        action: TrayAction::Hide,
                    },
                ),
                Err(error) => publish_integration_error(app, "tray", error),
            },
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                match window::window_toggle(app.clone()) {
                    Ok(_) => publish_native_event(
                        app,
                        NativeEvent::Tray {
                            action: TrayAction::Toggle,
                        },
                    ),
                    Err(error) => publish_integration_error(app, "tray", error),
                }
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn current_application_user_model_id() -> Option<String> {
    const ERROR_SUCCESS: u32 = 0;
    const ERROR_INSUFFICIENT_BUFFER: u32 = 122;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentApplicationUserModelId(length: *mut u32, app_id: *mut u16) -> u32;
    }

    let mut length = 0;
    let first = unsafe { GetCurrentApplicationUserModelId(&mut length, std::ptr::null_mut()) };
    if first != ERROR_INSUFFICIENT_BUFFER || length == 0 {
        return None;
    }

    let mut buffer = vec![0_u16; length as usize];
    let result = unsafe { GetCurrentApplicationUserModelId(&mut length, buffer.as_mut_ptr()) };
    if result != ERROR_SUCCESS {
        return None;
    }
    let terminator = buffer
        .iter()
        .position(|character| *character == 0)
        .unwrap_or(buffer.len());
    String::from_utf16(&buffer[..terminator])
        .ok()
        .filter(|app_id| !app_id.is_empty())
}

fn show_os_notification(identifier: &str, title: &str, body: &str) -> Result<(), NativeError> {
    #[cfg(target_os = "macos")]
    {
        use std::sync::OnceLock;
        static APPLICATION_CONFIGURED: OnceLock<Result<(), ()>> = OnceLock::new();
        let bundle_identifier = if cfg!(debug_assertions) {
            "com.apple.Terminal"
        } else {
            identifier
        };
        if APPLICATION_CONFIGURED
            .get_or_init(|| notify_rust::set_application(bundle_identifier).map_err(|_| ()))
            .is_err()
        {
            return Err(NativeError::new(
                "notification_failed",
                "the operating system notification service could not be configured",
            ));
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let _ = identifier;

    let mut notification = notify_rust::Notification::new();
    notification.summary(title).body(body).auto_icon();
    #[cfg(target_os = "windows")]
    if !cfg!(debug_assertions) {
        let app_id = current_application_user_model_id().unwrap_or_else(|| identifier.to_owned());
        notification.app_id(&app_id);
    }
    notification.show().map(|_| ()).map_err(|_| {
        NativeError::new(
            "notification_failed",
            "the operating system rejected the notification",
        )
    })
}

/// Display an operating-system notification and report delivery API failures.
#[tauri::command]
async fn notification_show(app: AppHandle, title: String, body: String) -> Result<(), NativeError> {
    if title.trim().is_empty() {
        return Err(NativeError::new(
            "invalid_notification",
            "notification title must not be empty",
        ));
    }
    let identifier = app.config().identifier.clone();
    let notification_title = title.clone();
    tauri::async_runtime::spawn_blocking(move || {
        show_os_notification(&identifier, &notification_title, &body)
    })
    .await
    .map_err(|_| {
        NativeError::new(
            "notification_failed",
            "the operating system notification worker stopped unexpectedly",
        )
    })??;
    publish_native_event(&app, NativeEvent::NotificationShown { title });
    Ok(())
}

/// Build the Guilda native shell and register all frontend-facing commands.
pub fn run() {
    tauri::Builder::default()
        .manage(NativeEventState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            publish_native_event(app, NativeEvent::SingleInstance);
            if let Err(error) = window::window_show(app.clone()) {
                publish_integration_error(app, "singleInstance", error);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            build_tray(app)?;
            let app_handle = app.handle().clone();
            app.deep_link().on_open_url({
                let app_handle = app_handle.clone();
                move |event| {
                    for url in event.urls() {
                        publish_invite_url(&app_handle, &url);
                    }
                }
            });
            if let Some(urls) = app.deep_link().get_current()? {
                for url in urls {
                    publish_invite_url(&app_handle, &url);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = crate::window::window_hide(window.app_handle().clone()) {
                    publish_integration_error(window.app_handle(), "window", error);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            api::native_events_ready,
            window::window_show,
            window::window_hide,
            window::window_toggle,
            token_store::auth_set_tokens,
            token_store::auth_get_tokens,
            token_store::auth_clear_tokens,
            media::request_media_permission,
            screen_capture::screen_capture_sources,
            screen_capture::screen_capture_frame,
            notification_show,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Guilda desktop shell");
}

#[cfg(test)]
mod tests {
    use super::parse_invite_url;
    use crate::api::NativeEvent;
    use url::Url;

    #[test]
    fn accepts_only_one_invite_code_segment() {
        let url = Url::parse("guilda://invite/abc123").expect("valid URL");
        let invite = parse_invite_url(&url).expect("valid invite");
        assert!(matches!(
            invite,
            NativeEvent::InviteDeepLink { ref code, .. } if code == "abc123"
        ));

        let extra = Url::parse("guilda://invite/abc/extra").expect("valid URL");

        let tracked = Url::parse("guilda://invite/abc123?source=external").expect("valid URL");
        assert!(parse_invite_url(&tracked).is_ok());
        assert!(parse_invite_url(&extra).is_err());

        for invalid in ["guilda://invite/abc", "guilda://invite/abc%20123"] {
            let url = Url::parse(invalid).expect("valid URL syntax");
            assert!(parse_invite_url(&url).is_err());
        }
    }

    #[test]
    fn serializes_single_instance_without_process_details() {
        let serialized =
            serde_json::to_value(NativeEvent::SingleInstance).expect("serialize native event");
        assert_eq!(serialized, serde_json::json!({ "type": "singleInstance" }));
    }
}
