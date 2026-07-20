#[allow(warnings)]
mod bindings;

use bindings::chat::plugin::types::SessionPurpose;
use bindings::exports::chat::plugin::sessions::Guest as Sessions;
use bindings::exports::chat::plugin::spaces::Guest as Spaces;

use psibase::AccountNumber;
use psibase_plugin::{
    trust::{Capabilities, TrustConfig},
    Error, Transact,
};
use std::str::FromStr;

mod errors;
use errors::ErrorType;

struct ChatPlugin;

impl TrustConfig for ChatPlugin {
    fn capabilities() -> Capabilities {
        Capabilities {
            low: &[],
            medium: &[
                "Opening or reusing chat spaces (DM, group, or explicit member list)",
                "Creating or closing WebRTC sessions for messaging or Meet",
            ],
            high: &[],
        }
    }
}

fn parse_members(members: Vec<String>) -> Result<Vec<AccountNumber>, Error> {
    members
        .iter()
        .map(|m| {
            AccountNumber::from_str(m)
                .map_err(|_| Error::from(ErrorType::InvalidAccountNumber(m.to_string())))
        })
        .collect()
}

fn purpose_to_chain(purpose: SessionPurpose) -> String {
    match purpose {
        SessionPurpose::ChatData => "chat-data".to_owned(),
        SessionPurpose::AvCall => "av-call".to_owned(),
    }
}

impl Spaces for ChatPlugin {
    #[psibase_plugin::authorized(Medium, whitelist = ["homepage"])]
    fn ensure_space(members: Vec<String>) -> Result<(), Error> {
        let members = parse_members(members)?;
        chat::Wrapper::add_to_tx().ensureSpace(members);
        Ok(())
    }

    #[psibase_plugin::authorized(Medium, whitelist = ["homepage"])]
    fn ensure_dm(contact: String) -> Result<(), Error> {
        let contact = AccountNumber::from_str(&contact)
            .map_err(|_| Error::from(ErrorType::InvalidAccountNumber(contact)))?;
        chat::Wrapper::add_to_tx().ensureDm(contact);
        Ok(())
    }

    #[psibase_plugin::authorized(Medium, whitelist = ["homepage"])]
    fn ensure_group(other_members: Vec<String>) -> Result<(), Error> {
        let other_members = parse_members(other_members)?;
        chat::Wrapper::add_to_tx().ensureGroup(other_members);
        Ok(())
    }
}

impl Sessions for ChatPlugin {
    #[psibase_plugin::authorized(Medium, whitelist = ["homepage"])]
    fn create_session(
        space_id: String,
        purpose: SessionPurpose,
        participants: Vec<String>,
    ) -> Result<(), Error> {
        let participants = parse_members(participants)?;
        chat::Wrapper::add_to_tx().createSession(
            space_id,
            purpose_to_chain(purpose),
            participants,
        );
        Ok(())
    }

    #[psibase_plugin::authorized(Medium, whitelist = ["homepage"])]
    fn close_session(session_id: String, reason: String) -> Result<(), Error> {
        chat::Wrapper::add_to_tx().closeSession(session_id, reason);
        Ok(())
    }

    #[psibase_plugin::authorized(Medium, whitelist = ["homepage"])]
    fn commit_webrtc_session_event(
        session_id: String,
        kind: u8,
        reason: String,
    ) -> Result<(), Error> {
        chat::Wrapper::add_to_tx().commitWebRtcSessionEvent(session_id, kind, reason);
        Ok(())
    }
}

bindings::export!(ChatPlugin with_types_in bindings);
