//! Native/WebView media permission boundary.
//!
//! On macOS, microphone and camera consent belongs to TCC and must be requested
//! by the signed application identity. The WebView still opens the devices via
//! `getUserMedia`, but native preflight makes that system decision durable.

use crate::api::NativeError;
use serde::{Deserialize, Serialize};

/// Media resource for which the frontend is about to invoke a Web API.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaResource {
    Microphone,
    Camera,
    Screen,
}

/// Result of checking or requesting a media resource.
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaPermissionStatus {
    Granted,
    Denied,
    /// The platform WebView remains responsible for the permission request.
    BrowserManaged,
}

/// Check or request permission before the frontend invokes a media Web API.
///
/// AVFoundation owns microphone/camera consent on macOS. Its TCC decision is
/// persisted against the packaged application's signing identity and bundle
/// identifier, and repeated requests return the existing decision.
#[tauri::command]
pub async fn request_media_permission(
    resource: MediaResource,
) -> Result<MediaPermissionStatus, NativeError> {
    match resource {
        MediaResource::Microphone | MediaResource::Camera => {
            #[cfg(target_os = "macos")]
            {
                request_macos_capture_permission(resource).await
            }

            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                Ok(MediaPermissionStatus::BrowserManaged)
            }

            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                Err(NativeError::new(
                    "unsupported_platform",
                    "microphone/camera permission request is not supported on this desktop target",
                ))
            }
        }
        MediaResource::Screen => {
            #[cfg(target_os = "linux")]
            {
                Err(NativeError::new(
                    "unsupported_platform",
                    "native screen permission request is not supported on Linux; use the WebView desktop portal",
                ))
            }

            #[cfg(any(target_os = "macos", target_os = "windows"))]
            {
                Ok(MediaPermissionStatus::BrowserManaged)
            }

            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                Err(NativeError::new(
                    "unsupported_platform",
                    "screen permission request is not supported on this desktop target",
                ))
            }
        }
    }
}

#[cfg(target_os = "macos")]
async fn request_macos_capture_permission(
    resource: MediaResource,
) -> Result<MediaPermissionStatus, NativeError> {
    use objc2_av_foundation::{
        AVAuthorizationStatus, AVCaptureDevice, AVMediaType, AVMediaTypeAudio, AVMediaTypeVideo,
    };
    use std::sync::Mutex;

    let media_type: &'static AVMediaType = unsafe {
        match resource {
            MediaResource::Microphone => AVMediaTypeAudio,
            MediaResource::Camera => AVMediaTypeVideo,
            MediaResource::Screen => unreachable!("screen capture is not an AVFoundation device"),
        }
    }
    .ok_or_else(|| {
        NativeError::new(
            "media_type_unavailable",
            "AVFoundation capture media type is unavailable",
        )
    })?;

    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) };
    if status == AVAuthorizationStatus::Authorized {
        return Ok(MediaPermissionStatus::Granted);
    }
    if status == AVAuthorizationStatus::Denied || status == AVAuthorizationStatus::Restricted {
        return Ok(MediaPermissionStatus::Denied);
    }

    let (sender, receiver) = futures_channel::oneshot::channel();
    let sender = Mutex::new(Some(sender));
    {
        let handler: block2::RcBlock<dyn Fn(objc2::runtime::Bool)> =
            block2::RcBlock::new(move |granted: objc2::runtime::Bool| {
                if let Ok(mut sender) = sender.lock() {
                    if let Some(sender) = sender.take() {
                        let _ = sender.send(granted.as_bool());
                    }
                }
            });
        unsafe {
            AVCaptureDevice::requestAccessForMediaType_completionHandler(media_type, &handler);
        }
    }

    let granted = receiver.await.map_err(|_| {
        NativeError::new(
            "media_permission_request_failed",
            "AVFoundation did not return a media permission decision",
        )
    })?;
    Ok(if granted {
        MediaPermissionStatus::Granted
    } else {
        MediaPermissionStatus::Denied
    })
}
