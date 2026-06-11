use psibase::{sha256, AccountNumber, Table};

use crate::spaces::{
    canonical_space_members, ensure_sender_is_member, members_of, space_exists, space_row,
    SpaceError,
};
use crate::tables::SPACE_KIND_GROUP;
use crate::tables::{
    SessionEventRow, SessionEventTable, SessionParticipantRow, SessionParticipantTable,
    SessionRow, SessionTable,
};

pub const PURPOSE_CHAT_DATA: &str = "chat-data";
pub const PURPOSE_AV_CALL: &str = "av-call";
/// Pair-only transport sessions (`wrtc:pair:lower:higher`) — no objective Space row.
pub const PAIR_SESSION_PREFIX: &str = "wrtc:pair:";

pub const SESSION_LIFECYCLE_ACTIVE: u8 = 1;
pub const SESSION_LIFECYCLE_ENDED: u8 = 2;
pub const SESSION_LIFECYCLE_FAILED: u8 = 3;

pub const SESSION_EVENT_PARTICIPANT_JOINED: u8 = 1;
pub const SESSION_EVENT_PARTICIPANT_LEFT: u8 = 2;
pub const SESSION_EVENT_SESSION_FAILED: u8 = 3;
pub const SESSION_EVENT_SESSION_ENDED: u8 = 4;

/// Default objective session TTL (24 hours).
pub const DEFAULT_SESSION_TTL_US: i64 = 86_400_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionError {
    InvalidPurpose(String),
    UnknownSpace(String),
    NotMember(String),
    InvalidParticipants(String),
    UnknownSession(String),
    SessionNotActive(String),
    UnauthorizedCaller(String),
}

impl From<SpaceError> for SessionError {
    fn from(err: SpaceError) -> Self {
        match err {
            SpaceError::UnknownSpace(msg) => SessionError::UnknownSpace(msg),
            SpaceError::NotMember(msg) => SessionError::NotMember(msg),
            SpaceError::InvalidMemberSet(msg) => SessionError::InvalidParticipants(msg),
        }
    }
}

impl SessionError {
    pub fn message(&self) -> String {
        match self {
            SessionError::InvalidPurpose(msg) => msg.clone(),
            SessionError::UnknownSpace(msg) => msg.clone(),
            SessionError::NotMember(msg) => msg.clone(),
            SessionError::InvalidParticipants(msg) => msg.clone(),
            SessionError::UnknownSession(msg) => msg.clone(),
            SessionError::SessionNotActive(msg) => msg.clone(),
            SessionError::UnauthorizedCaller(msg) => msg.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
    pub session_id: String,
    pub space_uuid: String,
    pub purpose: String,
    pub participants: Vec<AccountNumber>,
    pub lifecycle: u8,
    pub expires_at: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebRtcSessionEvent {
    pub session_id: String,
    pub kind: u8,
    pub account: AccountNumber,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionJoinAuth {
    pub session_id: String,
    pub authorized: bool,
    pub purpose: String,
    pub space_uuid: String,
    pub participants: Vec<AccountNumber>,
    pub lifecycle: u8,
    pub expires_at: i64,
    pub expired: bool,
}

pub fn is_valid_purpose(purpose: &str) -> bool {
    purpose == PURPOSE_CHAT_DATA || purpose == PURPOSE_AV_CALL
}

pub fn validate_purpose(purpose: &str) -> Result<(), SessionError> {
    if is_valid_purpose(purpose) {
        Ok(())
    } else {
        Err(SessionError::InvalidPurpose(format!(
            "unsupported session purpose: {purpose}"
        )))
    }
}

/// For group `chat-data` and `av-call` sessions, objective metadata always includes all
/// Space members (N-party mesh). DM and other purposes use the explicit participant list.
pub fn participants_for_session(
    space_kind: u8,
    purpose: &str,
    space_members: &[AccountNumber],
    explicit_participants: &[AccountNumber],
) -> Vec<AccountNumber> {
    if space_kind == SPACE_KIND_GROUP
        && (purpose == PURPOSE_CHAT_DATA || purpose == PURPOSE_AV_CALL)
    {
        canonical_space_members(space_members.iter().copied())
    } else {
        canonical_space_members(explicit_participants.iter().copied())
    }
}

/// Participants must be a non-empty subset of Space members; caller must be included.
pub fn validate_session_participants(
    sender: AccountNumber,
    space_members: &[AccountNumber],
    participants: &[AccountNumber],
) -> Result<Vec<AccountNumber>, SessionError> {
    let participants = canonical_space_members(participants.iter().copied());
    if participants.is_empty() {
        return Err(SessionError::InvalidParticipants(
            "session requires at least one participant".into(),
        ));
    }
    if !participants.iter().any(|p| *p == sender) {
        return Err(SessionError::InvalidParticipants(
            "caller must be included in session participants".into(),
        ));
    }
    for participant in &participants {
        if !space_members.iter().any(|m| m == participant) {
            return Err(SessionError::InvalidParticipants(format!(
                "participant {participant} is not a member of the space"
            )));
        }
    }
    Ok(participants)
}

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

/// Deterministic pair transport session id (v2 chat-data transport).
pub fn allocate_pair_session_id(a: AccountNumber, b: AccountNumber) -> String {
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
    Some(vec![
        AccountNumber::from(lower),
        AccountNumber::from(higher),
    ])
}

pub fn is_pair_session_id(session_id: &str) -> bool {
    parse_pair_session_id(session_id).is_some()
}

fn authorize_pair_session_join(
    session_id: &str,
    account: AccountNumber,
) -> Option<SessionJoinAuth> {
    let participants = parse_pair_session_id(session_id)?;
    let authorized = participants.iter().any(|p| *p == account);
    Some(SessionJoinAuth {
        session_id: session_id.to_owned(),
        authorized,
        purpose: PURPOSE_CHAT_DATA.to_owned(),
        space_uuid: String::new(),
        participants,
        lifecycle: SESSION_LIFECYCLE_ACTIVE,
        expires_at: 0,
        expired: false,
    })
}

pub fn allocate_session_id(
    space_uuid: &str,
    purpose: &str,
    participants: &[AccountNumber],
    created_at: i64,
    created_by: AccountNumber,
) -> String {
    let encoded_participants: Vec<String> = participants.iter().map(ToString::to_string).collect();
    let bytes = serde_json::to_vec(&(
        space_uuid,
        purpose,
        encoded_participants,
        created_at,
        created_by.value,
    ))
    .unwrap_or_default();
    format!("wrtc:{}", sha256(&bytes))
}

/// Objective session ids hash creation time; bump `created_at` until unused.
pub fn allocate_unique_session_id(
    space_uuid: &str,
    purpose: &str,
    participants: &[AccountNumber],
    mut created_at: i64,
    created_by: AccountNumber,
) -> (String, i64) {
    loop {
        let session_id = allocate_session_id(
            space_uuid,
            purpose,
            participants,
            created_at,
            created_by,
        );
        if session_row(&session_id).is_none() {
            return (session_id, created_at);
        }
        created_at = created_at.saturating_add(1);
    }
}

pub fn session_row(session_id: &str) -> Option<SessionRow> {
    SessionTable::read().get_index_pk().get(&session_id.to_owned())
}

pub fn participants_of_session(session_id: &str) -> Vec<AccountNumber> {
    SessionParticipantTable::read()
        .get_index_pk()
        .iter()
        .filter(|row| row.session_id == session_id)
        .map(|row| row.participant)
        .collect()
}

pub fn session_is_expired(row: &SessionRow, now: i64) -> bool {
    row.expires_at > 0 && now >= row.expires_at
}

pub fn session_to_view(row: SessionRow) -> Session {
    let session_id = row.session_id.clone();
    Session {
        session_id: row.session_id,
        space_uuid: row.space_uuid,
        purpose: row.purpose,
        participants: participants_of_session(&session_id),
        lifecycle: row.lifecycle,
        expires_at: row.expires_at,
        created_at: row.created_at,
    }
}

pub fn active_session_for_space(space_uuid: &str, purpose: &str) -> Option<SessionRow> {
    sessions_for_space(space_uuid, purpose)
        .into_iter()
        .find(|row| row.lifecycle == SESSION_LIFECYCLE_ACTIVE)
}

pub fn sessions_for_space(space_uuid: &str, purpose: &str) -> Vec<SessionRow> {
    SessionTable::read()
        .get_index_pk()
        .iter()
        .filter(|row| row.space_uuid == space_uuid && row.purpose == purpose)
        .collect()
}

pub fn create_session(
    space_uuid: &str,
    purpose: &str,
    participants: Vec<AccountNumber>,
    sender: AccountNumber,
    now: i64,
) -> Result<Session, SessionError> {
    validate_purpose(purpose)?;
    if !space_exists(space_uuid) {
        return Err(SessionError::UnknownSpace(format!(
            "unknown space {space_uuid}"
        )));
    }
    ensure_sender_is_member(space_uuid, sender)?;
    let space_row = space_row(space_uuid).ok_or_else(|| {
        SessionError::UnknownSpace(format!("unknown space {space_uuid}"))
    })?;
    let space_members = canonical_space_members(members_of(space_uuid));
    let resolved = participants_for_session(
        space_row.kind,
        purpose,
        &space_members,
        &participants,
    );
    let participants = validate_session_participants(sender, &space_members, &resolved)?;

    let mut session_created_at = now;
    if let Some(existing) = active_session_for_space(space_uuid, purpose) {
        if purpose == PURPOSE_AV_CALL {
            close_session(&existing.session_id, "superseded", sender, now)?;
            // Distinct objective session id when superseding within the same block time.
            session_created_at = now.saturating_add(1);
        } else {
            return Ok(session_to_view(existing));
        }
    }

    let expires_at = now.saturating_add(DEFAULT_SESSION_TTL_US);
    let (session_id, session_created_at) = allocate_unique_session_id(
        space_uuid,
        purpose,
        &participants,
        session_created_at,
        sender,
    );
    let row = SessionRow {
        session_id: session_id.clone(),
        space_uuid: space_uuid.to_owned(),
        purpose: purpose.to_owned(),
        lifecycle: SESSION_LIFECYCLE_ACTIVE,
        created_at: session_created_at,
        expires_at,
        created_by: sender,
    };
    SessionTable::new().put(&row).unwrap();

    let participant_table = SessionParticipantTable::new();
    for participant in participants {
        participant_table
            .put(&SessionParticipantRow {
                session_id: session_id.clone(),
                participant,
            })
            .unwrap();
    }

    if purpose == PURPOSE_AV_CALL {
        append_session_event(
            &session_id,
            crate::call_timeline::SESSION_EVENT_CALL_STARTED,
            sender,
            "started",
            now,
        );
    }

    Ok(session_to_view(row))
}

pub fn is_session_participant(session_id: &str, account: AccountNumber) -> bool {
    SessionParticipantTable::read()
        .get_index_pk()
        .get(&(session_id.to_owned(), account))
        .is_some()
}

pub fn authorize_session_join(session_id: &str, account: AccountNumber, now: i64) -> SessionJoinAuth {
    if let Some(pair_auth) = authorize_pair_session_join(session_id, account) {
        return pair_auth;
    }

    let Some(row) = session_row(session_id) else {
        return SessionJoinAuth {
            session_id: session_id.to_owned(),
            authorized: false,
            purpose: String::new(),
            space_uuid: String::new(),
            participants: vec![],
            lifecycle: 0,
            expires_at: 0,
            expired: false,
        };
    };
    let participants = participants_of_session(session_id);
    let expired = session_is_expired(&row, now);
    let authorized = row.lifecycle == SESSION_LIFECYCLE_ACTIVE
        && !expired
        && is_session_participant(session_id, account);
    SessionJoinAuth {
        session_id: session_id.to_owned(),
        authorized,
        purpose: row.purpose,
        space_uuid: row.space_uuid,
        participants,
        lifecycle: row.lifecycle,
        expires_at: row.expires_at,
        expired,
    }
}

pub fn append_session_event(
    session_id: &str,
    kind: u8,
    account: AccountNumber,
    reason: &str,
    at: i64,
) {
    SessionEventTable::new()
        .put(&SessionEventRow {
            session_id: session_id.to_owned(),
            kind,
            account,
            reason: reason.to_owned(),
            at,
        })
        .unwrap();
}

fn session_event_exists(session_id: &str, kind: u8, account: AccountNumber) -> bool {
    SessionEventTable::read()
        .get_index_pk()
        .iter()
        .any(|row| row.session_id == session_id && row.kind == kind && row.account == account)
}

/// Participant-committed lifecycle event after x-webrtcsig join/leave (objective write).
pub fn commit_webrtc_session_event(
    session_id: &str,
    kind: u8,
    account: AccountNumber,
    reason: &str,
    now: i64,
) -> Result<(), SessionError> {
    if !is_session_participant(session_id, account) {
        return Err(SessionError::NotMember(format!(
            "account is not a participant in session {session_id}"
        )));
    }

    let row = session_row(session_id).ok_or_else(|| {
        SessionError::UnknownSession(format!("unknown session {session_id}"))
    })?;
    if row.lifecycle != SESSION_LIFECYCLE_ACTIVE {
        return Err(SessionError::SessionNotActive(format!(
            "session {session_id} is not active"
        )));
    }

    match kind {
        SESSION_EVENT_PARTICIPANT_JOINED | SESSION_EVENT_PARTICIPANT_LEFT => {
            if session_event_exists(session_id, kind, account) {
                return Ok(());
            }
        }
        SESSION_EVENT_SESSION_FAILED | SESSION_EVENT_SESSION_ENDED => {}
        _ => {
            return Err(SessionError::InvalidPurpose(format!(
                "unsupported webrtc session event kind {kind}"
            )));
        }
    }

    apply_webrtc_session_event(
        WebRtcSessionEvent {
            session_id: session_id.to_owned(),
            kind,
            account,
            reason: reason.to_owned(),
        },
        now,
    )
}

pub fn apply_webrtc_session_event(
    event: WebRtcSessionEvent,
    now: i64,
) -> Result<(), SessionError> {
    let row = session_row(&event.session_id).ok_or_else(|| {
        SessionError::UnknownSession(format!("unknown session {}", event.session_id))
    })?;
    if row.lifecycle != SESSION_LIFECYCLE_ACTIVE {
        return Err(SessionError::SessionNotActive(format!(
            "session {} is not active",
            event.session_id
        )));
    }

    append_session_event(
        &event.session_id,
        event.kind,
        event.account,
        &event.reason,
        now,
    );

    let mut updated = row;
    match event.kind {
        SESSION_EVENT_SESSION_FAILED => {
            updated.lifecycle = SESSION_LIFECYCLE_FAILED;
        }
        SESSION_EVENT_SESSION_ENDED => {
            updated.lifecycle = SESSION_LIFECYCLE_ENDED;
        }
        _ => {}
    }
    if updated.lifecycle != SESSION_LIFECYCLE_ACTIVE {
        SessionTable::new().put(&updated).unwrap();
    }

    Ok(())
}

pub fn close_session(
    session_id: &str,
    reason: &str,
    sender: AccountNumber,
    now: i64,
) -> Result<(), SessionError> {
    let row = session_row(session_id).ok_or_else(|| {
        SessionError::UnknownSession(format!("unknown session {session_id}"))
    })?;
    if !is_session_participant(session_id, sender) {
        return Err(SessionError::NotMember(format!(
            "account is not a participant in session {session_id}"
        )));
    }
    if row.lifecycle != SESSION_LIFECYCLE_ACTIVE {
        return Err(SessionError::SessionNotActive(format!(
            "session {session_id} is not active"
        )));
    }
    append_session_event(
        session_id,
        SESSION_EVENT_SESSION_ENDED,
        sender,
        reason,
        now,
    );
    let mut updated = row;
    updated.lifecycle = SESSION_LIFECYCLE_ENDED;
    SessionTable::new().put(&updated).unwrap();
    Ok(())
}

#[cfg(test)]
mod unit_tests {
    use super::*;
    use psibase::AccountNumber;

    #[test]
    fn validate_purpose_accepts_chat_data_and_av_call() {
        assert!(validate_purpose(PURPOSE_CHAT_DATA).is_ok());
        assert!(validate_purpose(PURPOSE_AV_CALL).is_ok());
        assert!(validate_purpose("other").is_err());
    }

    #[test]
    fn participants_for_session_uses_all_members_for_group_chat_data() {
        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
        let members = vec![alice, bob, carol];

        let resolved = participants_for_session(
            SPACE_KIND_GROUP,
            PURPOSE_CHAT_DATA,
            &members,
            &[alice, bob],
        );
        assert_eq!(resolved, vec![alice, bob, carol]);
    }

    #[test]
    fn participants_for_session_keeps_explicit_list_for_dm_chat_data() {
        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let members = vec![alice, bob];

        let resolved = participants_for_session(
            crate::tables::SPACE_KIND_DM,
            PURPOSE_CHAT_DATA,
            &members,
            &[bob, alice],
        );
        assert_eq!(resolved, vec![alice, bob]);
    }

    #[test]
    fn participants_for_session_uses_all_members_for_group_av_call() {
        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
        let members = vec![alice, bob, carol];

        let resolved = participants_for_session(
            SPACE_KIND_GROUP,
            PURPOSE_AV_CALL,
            &members,
            &[alice, bob],
        );
        assert_eq!(resolved, vec![alice, bob, carol]);
    }

    #[test]
    fn participants_for_session_keeps_explicit_list_for_dm_av_call() {
        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let members = vec![alice, bob];

        let resolved = participants_for_session(
            crate::tables::SPACE_KIND_DM,
            PURPOSE_AV_CALL,
            &members,
            &[bob, alice],
        );
        assert_eq!(resolved, vec![alice, bob]);
    }

    #[test]
    fn validate_session_participants_requires_sender_and_space_members() {
        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
        let members = vec![alice, bob];

        let ok = validate_session_participants(alice, &members, &[bob, alice]).unwrap();
        assert_eq!(ok, vec![alice, bob]);

        let err = validate_session_participants(alice, &members, &[bob]).unwrap_err();
        assert!(err.message().contains("caller must be included"));

        let err = validate_session_participants(alice, &members, &[alice, carol]).unwrap_err();
        assert!(err.message().contains("not a member of the space"));
    }

    #[test]
    fn allocate_pair_session_id_is_lex_ordered() {
        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let id = allocate_pair_session_id(bob, alice);
        assert_eq!(id, "wrtc:pair:alice:bob");
        assert_eq!(allocate_pair_session_id(alice, bob), id);
    }

    #[test]
    fn parse_pair_session_id_round_trip() {
        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let id = allocate_pair_session_id(alice, bob);
        let parsed = parse_pair_session_id(&id).unwrap();
        assert_eq!(parsed, vec![alice, bob]);
    }

    #[test]
    fn authorize_pair_session_join_allows_e2e_group_pair_names() {
        let alice = AccountNumber::from("e2ealicegc");
        let carol = AccountNumber::from("e2ecarolgc");
        let id = "wrtc:pair:e2ealicegc:e2ecarolgc";
        let parsed = parse_pair_session_id(id).unwrap();
        assert_eq!(parsed, vec![alice, carol]);

        let alice_auth = authorize_session_join(id, alice, 0);
        assert!(alice_auth.authorized, "alice auth: {:?}", alice_auth);
        assert_eq!(alice_auth.purpose, PURPOSE_CHAT_DATA);

        let carol_auth = authorize_session_join(id, carol, 0);
        assert!(carol_auth.authorized);
    }

    #[test]
    fn authorize_pair_session_join_allows_participants_only() {
        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
        let id = allocate_pair_session_id(alice, bob);

        let alice_auth = authorize_session_join(&id, alice, 0);
        assert!(alice_auth.authorized);
        assert_eq!(alice_auth.purpose, PURPOSE_CHAT_DATA);
        assert_eq!(alice_auth.participants, vec![alice, bob]);
        assert_eq!(alice_auth.lifecycle, SESSION_LIFECYCLE_ACTIVE);

        let bob_auth = authorize_session_join(&id, bob, 0);
        assert!(bob_auth.authorized);

        let carol_auth = authorize_session_join(&id, carol, 0);
        assert!(!carol_auth.authorized);
    }

    #[test]
    fn allocate_session_id_is_stable_prefix() {
        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let id = allocate_session_id("space:abc", PURPOSE_CHAT_DATA, &[alice, bob], 1, alice);
        assert!(id.starts_with("wrtc:"));
        let id2 = allocate_session_id("space:abc", PURPOSE_CHAT_DATA, &[alice, bob], 1, alice);
        assert_eq!(id, id2);
    }

    #[test]
    fn session_is_expired_when_now_at_or_past_expires_at() {
        use crate::tables::SessionRow;

        let row = SessionRow {
            session_id: "wrtc:exp".into(),
            space_uuid: "space:1".into(),
            purpose: PURPOSE_CHAT_DATA.into(),
            lifecycle: SESSION_LIFECYCLE_ACTIVE,
            created_at: 0,
            expires_at: 1_000,
            created_by: AccountNumber::from("alice"),
        };
        assert!(!session_is_expired(&row, 999));
        assert!(session_is_expired(&row, 1_000));
        assert!(session_is_expired(&row, 1_001));
    }

    #[test]
    fn session_is_not_expired_when_expires_at_zero() {
        use crate::tables::SessionRow;

        let row = SessionRow {
            session_id: "wrtc:no-exp".into(),
            space_uuid: "space:1".into(),
            purpose: PURPOSE_CHAT_DATA.into(),
            lifecycle: SESSION_LIFECYCLE_ACTIVE,
            created_at: 0,
            expires_at: 0,
            created_by: AccountNumber::from("alice"),
        };
        assert!(!session_is_expired(&row, i64::MAX / 2));
    }
}
