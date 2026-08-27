//! Platform credential-vault storage for the persisted authentication session.
//!
//! macOS release builds use the Data Protection Keychain so access is tied to
//! the signed application instead of the legacy per-binary Keychain ACL prompt.
//! Unsigned debug builds use the login Keychain because the protected Keychain
//! rejects binaries without the release signing entitlement. Other platforms
//! use `keyring` (Credential Manager or Secret Service). Backend
//! failures are returned instead of silently falling back to plaintext storage.

use crate::api::NativeError;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "com.guilda.desktop";
const ACCOUNT: &str = "auth-tokens";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthTokens {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
}

fn validate(tokens: &AuthTokens) -> Result<(), NativeError> {
    if tokens.access_token.trim().is_empty()
        || tokens.refresh_token.trim().is_empty()
        || tokens.expires_in == 0
    {
        return Err(NativeError::new(
            "invalid_tokens",
            "accessToken, refreshToken, and a positive expiresIn are required",
        ));
    }
    Ok(())
}

fn encode(tokens: &AuthTokens) -> Result<String, NativeError> {
    validate(tokens)?;
    serde_json::to_string(tokens).map_err(|_| {
        NativeError::new(
            "token_serialization_failed",
            "the authentication session could not be encoded",
        )
    })
}

fn decode(serialized: &str) -> Result<AuthTokens, NativeError> {
    let tokens: AuthTokens = serde_json::from_str(serialized).map_err(|_| {
        NativeError::new(
            "token_deserialization_failed",
            "the saved authentication session is invalid",
        )
    })?;
    validate(&tokens)?;
    Ok(tokens)
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{decode, encode, AuthTokens, NativeError, ACCOUNT, SERVICE};
    use security_framework::passwords::{
        delete_generic_password_options, generic_password, set_generic_password_options,
        PasswordOptions,
    };

    const ITEM_NOT_FOUND: i32 = -25300;

    fn options() -> PasswordOptions {
        let mut options = PasswordOptions::new_generic_password(SERVICE, ACCOUNT);
        #[cfg(not(debug_assertions))]
        options.use_protected_keychain();
        options.set_access_synchronized(Some(false));
        options
    }

    fn keychain_error(_: security_framework::base::Error) -> NativeError {
        NativeError::new(
            "keychain_error",
            "the operating system credential vault operation failed",
        )
    }

    pub fn set(tokens: &AuthTokens) -> Result<(), NativeError> {
        let serialized = encode(tokens)?;
        set_generic_password_options(serialized.as_bytes(), options()).map_err(keychain_error)
    }

    pub fn get() -> Result<Option<AuthTokens>, NativeError> {
        match generic_password(options()) {
            Ok(serialized) => {
                let serialized = String::from_utf8(serialized).map_err(|_| {
                    NativeError::new(
                        "token_deserialization_failed",
                        "the saved authentication session is invalid",
                    )
                })?;
                decode(&serialized).map(Some)
            }
            Err(error) if error.code() == ITEM_NOT_FOUND => Ok(None),
            Err(error) => Err(keychain_error(error)),
        }
    }

    pub fn clear() -> Result<(), NativeError> {
        match delete_generic_password_options(options()) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == ITEM_NOT_FOUND => Ok(()),
            Err(error) => Err(keychain_error(error)),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{decode, encode, AuthTokens, NativeError, ACCOUNT, SERVICE};
    use keyring::Entry;

    fn entry() -> Result<Entry, NativeError> {
        Entry::new(SERVICE, ACCOUNT).map_err(NativeError::from)
    }

    pub fn set(tokens: &AuthTokens) -> Result<(), NativeError> {
        entry()?
            .set_password(&encode(tokens)?)
            .map_err(NativeError::from)
    }

    pub fn get() -> Result<Option<AuthTokens>, NativeError> {
        match entry()?.get_password() {
            Ok(serialized) => decode(&serialized).map(Some),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(NativeError::from(error)),
        }
    }

    pub fn clear() -> Result<(), NativeError> {
        match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(NativeError::from(error)),
        }
    }
}

/// Save the authentication bundle in the operating system credential vault.
#[tauri::command]
pub fn auth_set_tokens(tokens: AuthTokens) -> Result<(), NativeError> {
    platform::set(&tokens)
}

/// Read the authentication bundle from the operating system credential vault.
#[tauri::command]
pub fn auth_get_tokens() -> Result<Option<AuthTokens>, NativeError> {
    platform::get()
}

/// Delete the authentication bundle from the operating system credential vault.
#[tauri::command]
pub fn auth_clear_tokens() -> Result<(), NativeError> {
    platform::clear()
}

#[cfg(test)]
mod tests {
    use super::{decode, encode, AuthTokens};

    #[test]
    fn authentication_bundle_round_trips_without_losing_fields() {
        let tokens = AuthTokens {
            access_token: "access".into(),
            refresh_token: "refresh".into(),
            expires_in: 900,
        };

        let serialized = encode(&tokens).expect("serialize valid tokens");
        assert_eq!(decode(&serialized).expect("deserialize tokens"), tokens);
        assert!(serialized.contains("\"accessToken\""));
        assert!(serialized.contains("\"refreshToken\""));
        assert!(serialized.contains("\"expiresIn\""));
    }
}
