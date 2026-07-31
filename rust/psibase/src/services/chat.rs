/// Objective Chat service: Spaces (membership), sessions (`chat-data` / `av-call`),
/// and join-authorization for signaling (`x-wrtcsig`).
///
/// Published action/type surface for `verify_schema` against the Chat package.
/// Implementations live in `packages/user/Chat`; this module is stubs + schema only.
#[crate::service(name = "chat", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::AccountNumber;
    use crate::Fracpack;
    use async_graphql::SimpleObject;
    use fracpack::ToSchema;
    use serde::{Deserialize, Serialize};

    /// A Space: a durable set of accounts that can share sessions.
    ///
    /// Id form: `space:{sha256(canonical members)}`.
    #[derive(Fracpack, Serialize, Deserialize, ToSchema, SimpleObject, Debug, Clone, PartialEq, Eq)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct Space {
        /// Deterministic Space id (`space:…`).
        pub space_id: String,
        /// Canonical membership (sorted unique accounts).
        pub members: Vec<AccountNumber>,
    }

    /// An objective session bound to a Space and purpose.
    #[derive(Fracpack, Serialize, Deserialize, ToSchema, SimpleObject, Debug, Clone, PartialEq, Eq)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct Session {
        /// Session id (`wrtc:…` for Space sessions).
        pub session_id: String,
        /// Owning Space id.
        pub space_id: String,
        /// `"chat-data"` or `"av-call"`.
        pub purpose: String,
        /// Full Space membership at create time.
        pub participants: Vec<AccountNumber>,
        /// `1` = active, `2` = ended, `3` = failed.
        pub status: u8,
        /// Expiry time (UNIX microseconds); `0` if unused.
        pub expires_at: i64,
        /// Create time (UNIX microseconds).
        pub created_at: i64,
    }

    /// Timeline row for a session (same `kind` encoding as stored session events).
    ///
    /// Kinds: `1` joined, `2` left, `3` failed, `4` ended, `5` call started.
    #[derive(Fracpack, Serialize, Deserialize, ToSchema, SimpleObject, Debug, Clone, PartialEq, Eq)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct CallEvent {
        pub space_id: String,
        pub session_id: String,
        /// See struct docs for kind values.
        pub kind: u8,
        pub account: AccountNumber,
        pub reason: String,
        /// Event time (UNIX microseconds).
        pub at: i64,
    }

    /// Payload for recording a WebRTC/session lifecycle event.
    #[derive(Fracpack, Serialize, Deserialize, ToSchema, SimpleObject, Debug, Clone, PartialEq, Eq)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct WebRtcSessionEvent {
        pub session_id: String,
        /// Same kind values as [`CallEvent::kind`].
        pub kind: u8,
        pub account: AccountNumber,
        pub reason: String,
    }

    /// Result of checking whether an account may join a session (e.g. for signaling).
    #[derive(Fracpack, Serialize, Deserialize, ToSchema, SimpleObject, Debug, Clone, PartialEq, Eq)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct SessionJoinAuth {
        pub session_id: String,
        /// True if `account` may join: active, not expired, and a participant.
        pub authorized: bool,
        pub purpose: String,
        pub space_id: String,
        pub participants: Vec<AccountNumber>,
        /// Session status (`0` if the session is unknown).
        pub status: u8,
        pub expires_at: i64,
        /// True when `now` is past `expires_at` (and expiry is set).
        pub expired: bool,
    }

    /// Initialize the Chat service.
    #[action]
    fn init() {
        unimplemented!()
    }

    /// Ensure a Space exists for the given member set (caller must be included).
    ///
    /// Members are canonicalized (sorted unique). Returns the existing or newly created Space.
    #[action]
    fn ensureSpace(members: Vec<AccountNumber>) -> Space {
        unimplemented!()
    }

    /// Ensure a 1:1 DM Space between the caller and `contact`.
    #[action]
    fn ensureDm(contact: AccountNumber) -> Space {
        unimplemented!()
    }

    /// Ensure a group Space for the caller plus `other_members`.
    #[action]
    fn ensureGroup(other_members: Vec<AccountNumber>) -> Space {
        unimplemented!()
    }

    /// Look up a Space by id.
    #[action]
    fn getSpace(space_id: String) -> Option<Space> {
        unimplemented!()
    }

    /// True if `member` is in the Space's membership table.
    #[action]
    fn isSpaceMember(space_id: String, member: AccountNumber) -> bool {
        unimplemented!()
    }

    /// Spaces where the caller is a member.
    #[action]
    fn spacesForSender() -> Vec<Space> {
        unimplemented!()
    }

    /// Create an objective session for `space_id` with `purpose` (`"chat-data"` or `"av-call"`).
    ///
    /// Participants are always the full current Space membership. Caller must be a member.
    #[action]
    fn createSession(space_id: String, purpose: String) -> Session {
        unimplemented!()
    }

    /// End an active session (caller must be a participant).
    #[action]
    fn closeSession(session_id: String, reason: String) {
        unimplemented!()
    }

    /// Record a session event from the signaling service (`x-wrtcsig` only).
    #[action]
    fn webrtcSessionEvent(event: WebRtcSessionEvent) {
        unimplemented!()
    }

    /// Commit a session event attributed to the caller (participant join/leave, end, fail, …).
    #[action]
    fn commitWebRtcSessionEvent(session_id: String, kind: u8, reason: String) {
        unimplemented!()
    }

    /// Look up a session by id (with participants).
    #[action]
    fn getSession(session_id: String) -> Option<Session> {
        unimplemented!()
    }

    /// True if `account` is listed on the session's objective participant table.
    #[action]
    fn isSessionParticipant(session_id: String, account: AccountNumber) -> bool {
        unimplemented!()
    }

    /// Session timeline events for `session_id` (ordered; see [`CallEvent`] kinds).
    #[action]
    fn getCallEvents(session_id: String) -> Vec<CallEvent> {
        unimplemented!()
    }

    /// Authorize whether `account` may join `session_id` for signaling.
    ///
    /// Checks the objective session row: known, active, not expired, and participant.
    #[action]
    fn authorizeSessionJoin(session_id: String, account: AccountNumber) -> SessionJoinAuth {
        unimplemented!()
    }
}

pub use service::{CallEvent, Session, SessionJoinAuth, Space, WebRtcSessionEvent};

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
