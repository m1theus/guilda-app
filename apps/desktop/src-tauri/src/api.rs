//! Stable names and payloads shared by the Rust shell and the frontend.
//!
//! These strings are part of the desktop/frontend contract. Change them only with a
//! corresponding frontend migration.

use serde::Serialize;
use std::{
    collections::VecDeque,
    sync::{Mutex, MutexGuard},
};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

/// The single frontend-facing native event channel.
pub const EVENT_NATIVE: &str = "guilda://native-event";

/// Events sent by the native shell through [`EVENT_NATIVE`].
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum NativeEvent {
    InviteDeepLink {
        code: String,
    },
    SingleInstance,
    NotificationShown {
        title: String,
    },
    WindowVisibility {
        visibility: WindowVisibility,
    },
    Tray {
        action: TrayAction,
    },
    IntegrationError {
        integration: String,
        code: String,
        message: String,
    },
}

/// Visibility state returned by window commands and included in native events.
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowVisibility {
    Shown,
    Hidden,
}

/// Stable tray actions consumed by the frontend.
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TrayAction {
    Show,
    Hide,
    Toggle,
}

#[derive(Default)]
struct EventQueue {
    frontend_ready: bool,
    pending: VecDeque<NativeEvent>,
}

/// Queues startup events until the frontend has installed its listener.
#[derive(Default)]
pub struct NativeEventState(Mutex<EventQueue>);

impl NativeEventState {
    fn lock(&self) -> MutexGuard<'_, EventQueue> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Emit an event immediately after the frontend handshake, or retain it for retrieval.
pub fn publish_native_event<R: Runtime>(app: &AppHandle<R>, event: NativeEvent) {
    let state = app.state::<NativeEventState>();
    let mut queue = state.lock();
    if !queue.frontend_ready {
        queue.pending.push_back(event);
        return;
    }
    drop(queue);

    // Native work already succeeded. A closed window must not turn it into a command error.
    let _ = app.emit(EVENT_NATIVE, event);
}

/// Complete the listener handshake and atomically retrieve every cold-start event.
#[tauri::command]
pub fn native_events_ready(state: State<'_, NativeEventState>) -> Vec<NativeEvent> {
    let mut queue = state.lock();
    queue.frontend_ready = true;
    queue.pending.drain(..).collect()
}

/// Small structured error returned by native commands.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeError {
    /// Stable machine-readable error code.
    pub code: String,
    /// Safe human-readable description; secrets are never included.
    pub message: String,
}

impl std::fmt::Display for NativeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for NativeError {}

impl NativeError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[cfg(not(target_os = "macos"))]
impl From<keyring::Error> for NativeError {
    fn from(_: keyring::Error) -> Self {
        Self::new(
            "keyring_error",
            "the operating system credential vault operation failed",
        )
    }
}
