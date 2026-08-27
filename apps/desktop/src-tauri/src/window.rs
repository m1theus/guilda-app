//! Window commands exposed to the frontend.

use crate::api::{publish_native_event, NativeError, NativeEvent, WindowVisibility};
use tauri::{AppHandle, Manager, WebviewWindow};

fn main_window(app: &AppHandle) -> Result<WebviewWindow, NativeError> {
    app.get_webview_window("main").ok_or_else(|| {
        NativeError::new(
            "window_not_found",
            "the main Guilda window is not available",
        )
    })
}

fn emit_visibility(app: &AppHandle, visibility: WindowVisibility) {
    publish_native_event(app, NativeEvent::WindowVisibility { visibility });
}

/// Show and focus the main Guilda window.
#[tauri::command]
pub fn window_show(app: AppHandle) -> Result<(), NativeError> {
    let window = main_window(&app)?;
    window
        .show()
        .map_err(|error| NativeError::new("window_show_failed", error.to_string()))?;
    emit_visibility(&app, WindowVisibility::Shown);
    window
        .set_focus()
        .map_err(|error| NativeError::new("window_focus_failed", error.to_string()))?;
    Ok(())
}

/// Hide the main Guilda window without terminating the application.
#[tauri::command]
pub fn window_hide(app: AppHandle) -> Result<(), NativeError> {
    main_window(&app)?
        .hide()
        .map_err(|error| NativeError::new("window_hide_failed", error.to_string()))?;
    emit_visibility(&app, WindowVisibility::Hidden);
    Ok(())
}

/// Toggle the main Guilda window between visible and hidden states.
#[tauri::command]
pub fn window_toggle(app: AppHandle) -> Result<WindowVisibility, NativeError> {
    let window = main_window(&app)?;
    let visible = window
        .is_visible()
        .map_err(|error| NativeError::new("window_state_failed", error.to_string()))?;
    let visibility = if visible {
        window
            .hide()
            .map_err(|error| NativeError::new("window_hide_failed", error.to_string()))?;
        emit_visibility(&app, WindowVisibility::Hidden);
        WindowVisibility::Hidden
    } else {
        window
            .show()
            .map_err(|error| NativeError::new("window_show_failed", error.to_string()))?;
        emit_visibility(&app, WindowVisibility::Shown);
        window
            .set_focus()
            .map_err(|error| NativeError::new("window_focus_failed", error.to_string()))?;
        WindowVisibility::Shown
    };
    Ok(visibility)
}
