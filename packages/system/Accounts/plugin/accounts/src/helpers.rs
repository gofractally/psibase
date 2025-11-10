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

pub fn generate_account() -> Result<String, CommonTypes::Error> {
    let mut rng = rand::rng();

    const MAX_TRIES: u16 = 1000;

    let first_chars: &[char] = &(b'a'..=b'z').map(|b| b as char).collect::<Vec<_>>();
    let allowed_chars: &[char] = &(b'a'..=b'z')
        .chain(b'0'..=b'9')
        .map(|b| b as char)
        .collect::<Vec<_>>();

    for _ in 0..MAX_TRIES {
        let mut account = String::new();
        account.push(*first_chars.choose(&mut rng).unwrap());
        for _ in 0..9 {
            account.push(*allowed_chars.choose(&mut rng).unwrap());
        }

        if let Ok(None) = AccountsPlugin::get_account(account.clone()) {
            return Ok(account);
        }
    }
    Err(MaxGenerationAttemptsExceeded().into())
}
