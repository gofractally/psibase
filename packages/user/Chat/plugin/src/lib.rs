#[allow(warnings)]
mod bindings;

use bindings::exports::chat::plugin::api::Guest as Api;
use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::define_trust;
use psibase::fracpack::Pack;
use psibase::AccountNumber;
use std::str::FromStr;

mod errors;
use errors::ErrorType;

define_trust! {
    descriptions {
        Low => "
            - Opening or reusing chat spaces (DM, group, or explicit member list)
        ",
        Medium => "",
        High => "",
    }
    functions {
        Low => [ensure_space, ensure_dm, ensure_group, create_session, close_session],
    }
}

struct ChatPlugin;

fn parse_account(account: &str) -> Result<AccountNumber, Error> {
    AccountNumber::from_str(account)
        .map_err(|_| ErrorType::InvalidAccountNumber(account.to_string()).into())
}

fn parse_members(members: Vec<String>) -> Result<Vec<AccountNumber>, Error> {
    members.iter().map(|m| parse_account(m)).collect()
}

impl Api for ChatPlugin {
    fn ensure_space(members: Vec<String>) -> Result<(), Error> {
        trust::assert_authorized_with_whitelist(
            trust::FunctionName::ensure_space,
            vec!["homepage".into()],
        )?;
        let members = parse_members(members)?;
        let packed = chat::action_structs::ensureSpace { members }.packed();
        add_action_to_transaction(chat::action_structs::ensureSpace::ACTION_NAME, &packed)
            .unwrap();
        Ok(())
    }

    fn ensure_dm(contact: String) -> Result<(), Error> {
        trust::assert_authorized_with_whitelist(
            trust::FunctionName::ensure_dm,
            vec!["homepage".into()],
        )?;
        let contact = parse_account(&contact)?;
        let packed = chat::action_structs::ensureDm { contact }.packed();
        add_action_to_transaction(chat::action_structs::ensureDm::ACTION_NAME, &packed).unwrap();
        Ok(())
    }

    fn ensure_group(other_members: Vec<String>) -> Result<(), Error> {
        trust::assert_authorized_with_whitelist(
            trust::FunctionName::ensure_group,
            vec!["homepage".into()],
        )?;
        let other_members = parse_members(other_members)?;
        let packed = chat::action_structs::ensureGroup { other_members }.packed();
        add_action_to_transaction(chat::action_structs::ensureGroup::ACTION_NAME, &packed)
            .unwrap();
        Ok(())
    }

    fn create_session(
        space_uuid: String,
        purpose: String,
        participants: Vec<String>,
    ) -> Result<(), Error> {
        trust::assert_authorized_with_whitelist(
            trust::FunctionName::create_session,
            vec!["homepage".into()],
        )?;
        let participants = parse_members(participants)?;
        let packed = chat::action_structs::createSession {
            space_uuid,
            purpose,
            participants,
        }
        .packed();
        add_action_to_transaction(chat::action_structs::createSession::ACTION_NAME, &packed)
            .unwrap();
        Ok(())
    }

    fn close_session(session_id: String, reason: String) -> Result<(), Error> {
        trust::assert_authorized_with_whitelist(
            trust::FunctionName::close_session,
            vec!["homepage".into()],
        )?;
        let packed = chat::action_structs::closeSession {
            session_id,
            reason,
        }
        .packed();
        add_action_to_transaction(chat::action_structs::closeSession::ACTION_NAME, &packed)
            .unwrap();
        Ok(())
    }

    fn commit_webrtc_session_event(
        session_id: String,
        kind: u8,
        reason: String,
    ) -> Result<(), Error> {
        trust::assert_authorized_with_whitelist(
            trust::FunctionName::create_session,
            vec!["homepage".into()],
        )?;
        let packed = chat::action_structs::commitWebRtcSessionEvent {
            session_id,
            kind,
            reason,
        }
        .packed();
        add_action_to_transaction(
            chat::action_structs::commitWebRtcSessionEvent::ACTION_NAME,
            &packed,
        )
        .unwrap();
        Ok(())
    }
}

bindings::export!(ChatPlugin with_types_in bindings);
