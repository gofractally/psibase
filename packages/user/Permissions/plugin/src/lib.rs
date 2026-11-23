#[allow(warnings)]
mod bindings;

mod prompt_scope;
mod trust_policy;
mod types;
use types::*;

use bindings::*;

use bindings::host::accounts::api as HostAccounts;
use exports::permissions::plugin::{
    admin::{ApprovalDuration, Guest as PermsAdmin, PromptContext},
    api::Guest as Api,
};
use permissions::plugin::types::{Descriptions, TrustLevel};

use psibase_plugin::{
    host::{
        client::{self as HostClient, get_active_app, get_receiver, get_sender},
        prompt as HostPrompt,
        store::StorageDuration,
    },
    *,
};

mod errors;
use errors::*;

mod db;
use db::*;

struct PermissionsPlugin;

fn assert_admin() {
    assert_eq!(get_sender(), get_receiver())
}

fn checked_context() -> PackablePromptContext {
    assert_admin();
    // Host additionally enforces that only the app which created the prompt
    // may read its context. An arbitrary initiator cannot forge these fields.
    let context = HostPrompt::get_context::<PackablePromptContext>()
        .expect("permission request no longer available; start a fresh review");
    assert!(
        prompt_scope::matches_scope(
            &context.user,
            HostAccounts::get_current_user().as_deref(),
            &context.active_app,
            &get_active_app()
        ),
        "permission request account or application changed; start a fresh review"
    );
    context
}

impl PermsAdmin for PermissionsPlugin {
    fn get_context() -> PromptContext {
        checked_context().into()
    }

    fn approve(duration: ApprovalDuration) {
        let context = checked_context();

        Permissions::set(
            &context.user,
            &context.caller,
            &context.callee,
            context.level.into(),
            match duration {
                ApprovalDuration::Session => StorageDuration::Session,
                ApprovalDuration::Permanent => StorageDuration::Persistent,
            },
        )
    }
}

fn is_already_authorized(user: &str, caller: &str, callee: &str, trust: TrustLevel) -> bool {
    Permissions::get(user, caller, callee).map_or(false, |perm| trust_at_least(perm, trust))
}

fn validate_caller(caller: &str) -> bool {
    if caller == get_active_app() {
        return true;
    }

    let allowed_callers = AllowedCallers::get();
    allowed_callers.contains(&caller.to_string())
}

enum AuthResult {
    Authorized,
    Denied,
    NeedsPrompt { user: String },
}

fn auth_check(
    caller: &str,
    callee: &str,
    level: TrustLevel,
    whitelist: &[String],
    debug_label: &str,
) -> Result<AuthResult, Error> {
    // Auto approve for trust level: none
    if level == TrustLevel::None {
        return Ok(AuthResult::Authorized);
    }

    // Whitelisted accounts are authorized
    if whitelist.iter().any(|w| w == caller) {
        return Ok(AuthResult::Authorized);
    }

    // Callee is always authorized to call itself
    if caller == callee {
        return Ok(AuthResult::Authorized);
    }

    // Max trust level is only allowed when caller == callee
    // TODO incorporate security groups for TrustLevel::Max
    if level == TrustLevel::Max {
        return Ok(AuthResult::Denied);
    }

    if !validate_caller(caller) {
        return Err(ErrorType::InvalidCaller(
            caller.to_string(),
            callee.to_string(),
            debug_label.to_string(),
        )
        .into());
    }

    let user = HostAccounts::get_current_user().ok_or_else(|| {
        ErrorType::LoggedInUserDNE(
            caller.to_string(),
            callee.to_string(),
            debug_label.to_string(),
        )
    })?;
    if is_already_authorized(&user, caller, callee, level) {
        Ok(AuthResult::Authorized)
    } else {
        Ok(AuthResult::NeedsPrompt { user })
    }
}

impl Api for PermissionsPlugin {
    fn set_allowed_callers(callers: Vec<String>) {
        assert_eq!(
            get_sender(),
            get_active_app(),
            "[set-allowed-callers] Only the active app can set allowed callers"
        );

        AllowedCallers::set(callers);
    }

    fn has_auth(caller: String, level: TrustLevel, whitelist: Vec<String>) -> bool {
        let callee = HostClient::get_sender();
        matches!(
            auth_check(&caller, &callee, level, &whitelist, ""),
            Ok(AuthResult::Authorized)
        )
    }

    fn is_authorized(
        caller: String,
        level: TrustLevel,
        descriptions: Descriptions,
        debug_label: String,
        whitelist: Vec<String>,
    ) -> Result<bool, Error> {
        let callee = HostClient::get_sender();

        let user = match auth_check(&caller, &callee, level, &whitelist, debug_label.as_str())? {
            AuthResult::Authorized => return Ok(true),
            AuthResult::Denied => return Ok(false),
            AuthResult::NeedsPrompt { user } => user,
        };

        HostPrompt::prompt(
            "permissions",
            Some(&PackablePromptContext {
                user: user.to_string(),
                caller: caller.clone(),
                callee: callee.clone(),
                level: level.into(),
                descriptions,
                active_app: get_active_app(),
            }),
        );

        if is_already_authorized(&user, &caller, &callee, level) {
            return Ok(true);
        }
        Ok(false)
    }
}

export!(PermissionsPlugin with_types_in bindings);
