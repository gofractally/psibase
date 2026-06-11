use crate::bindings::exports::accounts::plugin::api::Guest;
use crate::bindings::host::common::client as Client;
use crate::bindings::host::types::types as CommonTypes;
use crate::errors::ErrorType::*;
use crate::plugin::AccountsPlugin;

/// Asserts that the caller of the current plugin function is the top-level app,
///    or one of the privileged apps.
/// Returns the top-level app data.
pub fn get_assert_top_level_app(
    context: &str,
    privileged_apps: &[&str],
) -> Result<String, CommonTypes::Error> {
    let sender_app_name = Client::get_sender();
    let top_level_app = Client::get_active_app();

    let is_privileged = privileged_apps.contains(&sender_app_name.as_str());

    if is_privileged {
        return Ok(top_level_app);
    }

    if sender_app_name == top_level_app {
        return Ok(top_level_app);
    }

    return Err(Unauthorized(&format!(
        "{} can only be called by the top-level app.",
        context
    ))
    .into());
}

pub fn assert_valid_account(account: &str) {
    let account_details =
        AccountsPlugin::get_account(account.to_string()).expect("Get account failed");
    assert!(account_details.is_some(), "Invalid account name");
}

use rand::prelude::*;

pub fn generate_account(prefix: Option<String>) -> Result<String, CommonTypes::Error> {
    let mut rng = rand::rng();

    const MAX_TRIES: u16 = 1000;
    const LENGTH: u8 = 10;

    let first_chars: &[char] = &(b'a'..=b'z').map(|b| b as char).collect::<Vec<_>>();
    let allowed_chars: &[char] = &(b'a'..=b'z')
        .chain(b'0'..=b'9')
        .map(|b| b as char)
        .collect::<Vec<_>>();

    let starting_string = prefix.unwrap_or_default();

    let starts_with_x = starting_string.starts_with("x-");
    let is_invalid_length = starting_string.len() > 9;
    let is_valid_chars = starting_string.chars().enumerate().all(|(index, char)| {
        if index == 0 {
            first_chars.contains(&char)
        } else {
            allowed_chars.contains(&char) || char == '-'
        }
    });
    if is_invalid_length || !is_valid_chars || starts_with_x {
        return Err(InvalidPrefix().into());
    }

    for _ in 0..MAX_TRIES {
        let mut account = starting_string.clone();
        if account.len() == 0 {
            account.push(*first_chars.choose(&mut rng).unwrap());
        }
        let remaining_chars = LENGTH - account.len() as u8;

        for _ in 0..remaining_chars {
            account.push(*allowed_chars.choose(&mut rng).unwrap());
        }

        if let Ok(None) = AccountsPlugin::get_account(account.clone()) {
            return Ok(account);
        }
    }
    Err(MaxGenerationAttemptsExceeded().into())
}
