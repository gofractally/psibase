#[allow(warnings)]
mod bindings;

mod types;
use types::*;

use bindings::*;

use accounts::plugin::api as Accounts;
use exports::permissions::plugin::{
    admin::{ApprovalDuration, Guest as PermsAdmin, PromptContext},
    api::Guest as Api,
};
use permissions::plugin::types::{Descriptions, TrustLevel};
use psibase::fracpack::{Pack, Unpack};

use host::common::{
    client as HostClient,
    client::{get_active_app, get_receiver, get_sender},
    store::StorageDuration,
};
use host::prompt::api as HostPrompt;
use host::types::types::Error;

mod errors;
use errors::*;

mod db;
use db::*;

struct PermissionsPlugin;

fn assert_admin() {
    assert_eq!(get_sender(), get_receiver())
}

impl PermsAdmin for PermissionsPlugin {
    fn get_context(context_id: String) -> PromptContext {
        assert_admin();
        let context = HostPrompt::get_context(&context_id).unwrap();
        PackablePromptContext::unpacked(&context).unwrap().into()
    }

    fn approve(context_id: String, duration: ApprovalDuration) {
        assert_admin();
        let context = HostPrompt::get_context(&context_id).unwrap();
        let context = PackablePromptContext::unpacked(&context).unwrap();

        Permissions::set(
            &context.user,
            &context.caller,
            &context.callee,
            context.level,
            match duration {
                ApprovalDuration::Session => StorageDuration::Session,
                ApprovalDuration::Permanent => StorageDuration::Persistent,
            },
        )
    }
}

fn is_authorized(user: &str, caller: &str, callee: &str, trust: TrustLevel) -> bool {
    Permissions::get(user, caller, callee).map_or(false, |perm| perm >= trust)
}

fn validate_caller(caller: &str) -> bool {
    if caller == get_active_app() {
        return true;
    }

    let allowed_callers = AllowedCallers::get();
    allowed_callers.contains(&caller.to_string())
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

    fn authorize(
        caller: String,
        level: TrustLevel,
        descriptions: Descriptions,
        debug_label: String,
        whitelist: Vec<String>,
    ) -> Result<bool, Error> {
        let callee = HostClient::get_sender();

        if level == TrustLevel::None {
            // Auto approve for trust level: none
            return Ok(true);
        }
        if whitelist.contains(&caller) {
            // Whitelisted accounts are authorized
            return Ok(true);
        }
        if caller == callee {
            // Callee is always authorized to call itself
            return Ok(true);
        }
        // TODO incorporate security groups for TrustLevel::Max

        if !validate_caller(&caller) {
            return Err(ErrorType::InvalidCaller(
                caller.clone(),
                callee.clone(),
                debug_label.clone(),
            )
            .into());
        }

        let user = Accounts::get_current_user().ok_or_else(|| {
            ErrorType::LoggedInUserDNE(caller.clone(), callee.clone(), debug_label.clone())
        })?;
        if is_authorized(&user, &caller, &callee, level) {
            return Ok(true);
        }

        let packed_context = PackablePromptContext {
            user: user.to_string(),
            caller: caller.to_string(),
            callee: callee.to_string(),
            level,
            descriptions,
        }
        .packed();

        HostPrompt::prompt("permissions".into(), Some(&packed_context));
        Ok(false)
    }
}

export!(PermissionsPlugin with_types_in bindings);
