use psibase::AccountNumber;

use crate::tables::SessionJoinAuth;

use super::types::{PAIR_SESSION_PREFIX, PURPOSE_CHAT_DATA, SESSION_STATUS_ACTIVE};

/// Canonical lex order for a two-account pair (stable initiator / pair id).
pub fn canonical_pair_accounts(
    a: AccountNumber,
    b: AccountNumber,
) -> (AccountNumber, AccountNumber) {
    if a.value <= b.value {
        (a, b)
    } else {
        (b, a)
    }
}

/// Deterministic pair transport session id (`wrtc:pair:{lower}:{higher}`).
///
/// Canonical formatter for the PR5+ L2 mesh: clients/transport invent this id
/// (no objective `SessionRow`). Chat authorizes joins by parsing the same form.
pub fn pair_session_id_for(a: AccountNumber, b: AccountNumber) -> String {
    let (lower, higher) = canonical_pair_accounts(a, b);
    format!("{PAIR_SESSION_PREFIX}{lower}:{higher}")
}

/// Parse `wrtc:pair:lower:higher` into the two participant accounts.
pub fn parse_pair_session_id(session_id: &str) -> Option<Vec<AccountNumber>> {
    let rest = session_id.strip_prefix(PAIR_SESSION_PREFIX)?;
    let (lower, higher) = rest.split_once(':')?;
    if lower.is_empty() || higher.is_empty() {
        return None;
    }
    Some(vec![lower.parse().ok()?, higher.parse().ok()?])
}

pub(crate) fn authorize_pair_session_join(
    session_id: &str,
    account: AccountNumber,
) -> Option<SessionJoinAuth> {
    let participants = parse_pair_session_id(session_id)?;
    let authorized = participants.iter().any(|p| *p == account);
    Some(SessionJoinAuth {
        session_id: session_id.to_owned(),
        authorized,
        purpose: PURPOSE_CHAT_DATA.to_owned(),
        space_id: String::new(),
        participants,
        status: SESSION_STATUS_ACTIVE,
        expires_at: 0,
        expired: false,
    })
}
