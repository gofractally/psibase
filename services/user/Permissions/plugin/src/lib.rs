#[allow(warnings)]
mod bindings;
use bindings::*;

use accounts::plugin::api as Accounts;
use exports::permissions::plugin::{
    admin::{ApprovalDuration, Guest as PermsAdmin, PromptContext},
    api::Guest as Api,
};
use permissions::plugin::types::Trust;
use psibase::fracpack::{Pack, Unpack};

use host::common::{
    client as HostClient,
    client::{get_receiver, get_sender},
    store::StorageDuration,
    types::Error,
};
use host::prompt::web as HostPrompt;

mod errors;
use errors::*;

mod db;
use db::*;

#[derive(Pack, Unpack)]
struct PackablePromptContext {
    user: String,
    caller: String,
    callee: String,
    trust_level: u8,
    description: String,
}

impl From<PackablePromptContext> for PromptContext {
    fn from(context: PackablePromptContext) -> Self {
        PromptContext {
            user: context.user,
            caller: context.caller,
            callee: context.callee,
            trust_level: context.trust_level,
            description: context.description,
        }
    }
}

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
            context.trust_level,
            match duration {
                ApprovalDuration::Session => StorageDuration::Session,
                ApprovalDuration::Permanent => StorageDuration::Persistent,
            },
        )
    }
}

fn is_authorized(user: &str, caller: &str, callee: &str, trust: u8) -> bool {
    Permissions::get(user, caller, callee).map_or(false, |perm| perm >= trust)
}

impl Api for PermissionsPlugin {
    fn authorize(
        caller: String,
        trust: Trust,
        debug_label: String,
        whitelist: Vec<String>,
    ) -> Result<bool, Error> {
        let callee = HostClient::get_sender();
        if !(0..=4).contains(&trust.level) {
            return Err(ErrorType::InvalidTrustLevel(
                callee.clone(),
                trust.level,
                debug_label.clone(),
            )
            .into());
        }

        if trust.level == 0 {
            // Everyone has trust level 0
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
        // TODO incorporate security groups for trust level 4

        let user = Accounts::get_current_user().ok_or_else(|| {
            ErrorType::LoggedInUserDNE(caller.clone(), callee.clone(), debug_label.clone())
        })?;
        if is_authorized(&user, &caller, &callee, trust.level) {
            return Ok(true);
        }

        let packed_context = PackablePromptContext {
            user: user.to_string(),
            caller: caller.to_string(),
            callee: callee.to_string(),
            trust_level: trust.level,
            description: trust.description.to_string(),
        }
        .packed();

        let context_id = HostPrompt::store_context(&packed_context);
        HostPrompt::prompt_user(Some("/permissions.html"), Some(&context_id))?;
        Ok(false)
    }
}

export!(PermissionsPlugin with_types_in bindings);
