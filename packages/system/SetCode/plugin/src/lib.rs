#[allow(warnings)]
mod bindings;

use bindings::*;
use exports::setcode::plugin::api::Guest as Api;
use psibase::services::setcode::action_structs::{setCode, stageCode};
use psibase::AccountNumber;
use transact::plugin::intf::add_action_to_transaction;

use crate::trust::*;
use psibase::fracpack::Pack;

psibase::define_trust! {
    descriptions {
        Low => "",
        Medium => "",
        High => "
        High trust grants these abilities:
            - Set service code for accounts
            - Stage service code for accounts
        ",
    }
    functions {
        None => [],
        Low => [],
        High => [set_service_code, stage_service_code],
    }
}

struct SetcodePlugin;

impl Api for SetcodePlugin {
    fn set_service_code(account: String, code: Vec<u8>) {
        assert_authorized_with_whitelist(FunctionName::set_service_code, vec!["workshop".into()])
            .unwrap();

        add_action_to_transaction(
            setCode::ACTION_NAME,
            &setCode {
                service: AccountNumber::from(account.as_str()),
                vmType: 0,
                vmVersion: 0,
                code: code.into(),
            }
            .packed(),
        )
        .unwrap();
    }
    fn stage_service_code(account: String, id: u64, code: Vec<u8>) {
        assert_authorized_with_whitelist(
            FunctionName::stage_service_code,
            vec!["workshop".into(), "packages".into()],
        )
        .unwrap();

        add_action_to_transaction(
            stageCode::ACTION_NAME,
            &stageCode {
                service: AccountNumber::from(account.as_str()),
                id,
                vmType: 0,
                vmVersion: 0,
                code: code.into(),
            }
            .packed(),
        )
        .unwrap();
    }
}
bindings::export!(SetcodePlugin with_types_in bindings);
