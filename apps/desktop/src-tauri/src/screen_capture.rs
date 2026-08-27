use crate::api::NativeError;
use serde::Serialize;
use tauri::ipc::Response;

const UNSUPPORTED_CODE: &str = "UNSUPPORTED";

/// A source that can be captured by the native Windows picker replacement.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCaptureSource {
    pub id: String,
    pub name: String,
    pub kind: ScreenCaptureSourceKind,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ScreenCaptureSourceKind {
    #[cfg(target_os = "windows")]
    Screen,
    #[cfg(target_os = "windows")]
    Window,
}

fn unsupported_error() -> NativeError {
    NativeError::new(
        UNSUPPORTED_CODE,
        "Native screen capture is only available on Windows.",
    )
}

#[cfg(target_os = "windows")]
mod windows {
    use super::{NativeError, ScreenCaptureSource, ScreenCaptureSourceKind};
    use tauri::ipc::Response;
    use xcap::{Monitor, Window};

    const MAX_WIDTH: u32 = 1_920;
    const JPEG_QUALITY: u8 = 90;

    fn xcap_error(code: &str, error: impl std::fmt::Display) -> NativeError {
        NativeError::new(code, error.to_string())
    }

    fn monitor_name(monitor: &Monitor, id: u32) -> String {
        monitor
            .friendly_name()
            .or_else(|_| monitor.name())
            .ok()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| format!("Monitor {id}"))
    }

    fn window_name(window: &Window, id: u32) -> String {
        window
            .title()
            .or_else(|_| window.app_name())
            .ok()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| format!("Window {id}"))
    }

    pub(super) fn enumerate_sources() -> Result<Vec<ScreenCaptureSource>, NativeError> {
        let mut sources = Vec::new();
        for monitor in Monitor::all().map_err(|error| xcap_error("ENUMERATION_FAILED", error))? {
            let id = monitor
                .id()
                .map_err(|error| xcap_error("ENUMERATION_FAILED", error))?;
            sources.push(ScreenCaptureSource {
                id: format!("monitor:{id}"),
                name: monitor_name(&monitor, id),
                kind: ScreenCaptureSourceKind::Screen,
            });
        }

        // xcap's Windows backend filters invisible/cloaked windows. Keep the additional
        // minimized check here so a source cannot become invalid between enumeration and use.
        for window in Window::all().map_err(|error| xcap_error("ENUMERATION_FAILED", error))? {
            if window
                .is_minimized()
                .map_err(|error| xcap_error("ENUMERATION_FAILED", error))?
            {
                continue;
            }
            let id = window
                .id()
                .map_err(|error| xcap_error("ENUMERATION_FAILED", error))?;
            sources.push(ScreenCaptureSource {
                id: format!("window:{id}"),
                name: window_name(&window, id),
                kind: ScreenCaptureSourceKind::Window,
            });
        }

        Ok(sources)
    }

    fn parse_source_id(source_id: &str) -> Result<(&str, u32), NativeError> {
        let (kind, id) = source_id.split_once(':').ok_or_else(|| {
            NativeError::new(
                "INVALID_SOURCE",
                "Screen capture source id must be monitor:<u32> or window:<u32>.",
            )
        })?;
        if kind != "monitor" && kind != "window" {
            return Err(NativeError::new(
                "INVALID_SOURCE",
                "Screen capture source id must be monitor:<u32> or window:<u32>.",
            ));
        }
        let id = id.parse::<u32>().map_err(|_| {
            NativeError::new(
                "INVALID_SOURCE",
                "Screen capture source id must be monitor:<u32> or window:<u32>.",
            )
        })?;
        Ok((kind, id))
    }

    fn scale_for_jpeg(image: xcap::image::RgbaImage) -> xcap::image::RgbaImage {
        if image.width() <= MAX_WIDTH {
            return image;
        }
        let height =
            ((image.height() as u64 * MAX_WIDTH as u64) / image.width() as u64).max(1) as u32;
        xcap::image::imageops::resize(
            &image,
            MAX_WIDTH,
            height,
            xcap::image::imageops::FilterType::Lanczos3,
        )
    }

    fn encode_jpeg(image: xcap::image::RgbaImage) -> Result<Response, NativeError> {
        let image = scale_for_jpeg(image);
        let pixels = u64::from(image.width()) * u64::from(image.height());
        // Reserve the upper bound used by the encoder's RGB payload plus headers. The
        // response takes ownership of this Vec; no base64 or JSON frame copy is made.
        let capacity = pixels
            .saturating_mul(3)
            .saturating_add(64 * 1024)
            .min(usize::MAX as u64) as usize;
        let mut bytes = Vec::with_capacity(capacity);
        let mut encoder =
            xcap::image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, JPEG_QUALITY);
        encoder
            .encode_image(&image)
            .map_err(|error| xcap_error("ENCODE_FAILED", error))?;
        Ok(Response::new(bytes))
    }

    pub(super) fn capture_frame(source_id: &str) -> Result<Response, NativeError> {
        let (kind, id) = parse_source_id(source_id)?;
        match kind {
            "monitor" => {
                let monitor = Monitor::all()
                    .map_err(|error| xcap_error("ENUMERATION_FAILED", error))?
                    .into_iter()
                    .find(|monitor| monitor.id().map(|value| value == id).unwrap_or(false))
                    .ok_or_else(|| {
                        NativeError::new("SOURCE_NOT_FOUND", "Monitor is no longer available.")
                    })?;
                let image = monitor
                    .capture_image()
                    .map_err(|error| xcap_error("CAPTURE_FAILED", error))?;
                encode_jpeg(image)
            }
            "window" => {
                let window = Window::all()
                    .map_err(|error| xcap_error("ENUMERATION_FAILED", error))?
                    .into_iter()
                    .find(|window| {
                        window.id().map(|value| value == id).unwrap_or(false)
                            && !window.is_minimized().unwrap_or(true)
                    })
                    .ok_or_else(|| {
                        NativeError::new("SOURCE_NOT_FOUND", "Window is no longer available.")
                    })?;
                let image = window
                    .capture_image()
                    .map_err(|error| xcap_error("CAPTURE_FAILED", error))?;
                encode_jpeg(image)
            }
            _ => unreachable!("source kind validated by parse_source_id"),
        }
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn screen_capture_sources() -> Result<Vec<ScreenCaptureSource>, NativeError> {
    tauri::async_runtime::spawn_blocking(windows::enumerate_sources)
        .await
        .map_err(|error| NativeError::new("CAPTURE_TASK_FAILED", error.to_string()))?
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn screen_capture_sources() -> Result<Vec<ScreenCaptureSource>, NativeError> {
    Err(unsupported_error())
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn screen_capture_frame(source_id: String) -> Result<Response, NativeError> {
    tauri::async_runtime::spawn_blocking(move || windows::capture_frame(&source_id))
        .await
        .map_err(|error| NativeError::new("CAPTURE_TASK_FAILED", error.to_string()))?
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn screen_capture_frame(_source_id: String) -> Result<Response, NativeError> {
    Err(unsupported_error())
}
