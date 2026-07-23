#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{AccountNumber, Fracpack, ToSchema};
    use serde::{Deserialize, Serialize};

    pub const SPACE_KIND_DM: u8 = 1;
    pub const SPACE_KIND_GROUP: u8 = 2;

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "SpaceTable", index = 1)]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, ToSchema, Serialize, Deserialize)]
    pub struct SpaceRow {
        #[primary_key]
        pub space_id: String,
        pub kind: u8,
        pub created_at: i64,
    }

    #[table(name = "SpaceMemberTable", index = 2)]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, ToSchema, Serialize, Deserialize)]
    pub struct SpaceMemberRow {
        pub space_id: String,
        pub member: AccountNumber,
    }

    impl SpaceMemberRow {
        #[primary_key]
        fn pk(&self) -> (String, AccountNumber) {
            (self.space_id.clone(), self.member)
        }

        #[secondary_key(1)]
        fn by_member_space(&self) -> (AccountNumber, String) {
            (self.member, self.space_id.clone())
        }
    }

    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct Space {
        pub space_id: String,
        pub members: Vec<AccountNumber>,
    }

    #[table(name = "SessionTable", index = 3)]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, ToSchema, Serialize, Deserialize)]
    pub struct SessionRow {
        #[primary_key]
        pub session_id: String,
        pub space_id: String,
        pub purpose: String,
        pub status: u8,
        pub created_at: i64,
        pub expires_at: i64,
        pub created_by: AccountNumber,
    }

    #[table(name = "SessionParticipantTable", index = 4)]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, ToSchema, Serialize, Deserialize)]
    pub struct SessionParticipantRow {
        pub session_id: String,
        pub participant: AccountNumber,
    }

    impl SessionParticipantRow {
        #[primary_key]
        fn pk(&self) -> (String, AccountNumber) {
            (self.session_id.clone(), self.participant)
        }
    }

    #[table(name = "SessionEventTable", index = 5)]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, ToSchema, Serialize, Deserialize)]
    pub struct SessionEventRow {
        pub session_id: String,
        pub kind: u8,
        pub account: AccountNumber,
        pub reason: String,
        pub at: i64,
    }

    impl SessionEventRow {
        #[primary_key]
        fn pk(&self) -> (String, i64, u8, AccountNumber) {
            (self.session_id.clone(), self.at, self.kind, self.account)
        }
    }

    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct CallEvent {
        pub space_id: String,
        pub session_id: String,
        pub kind: u8,
        pub account: AccountNumber,
        pub reason: String,
        pub at: i64,
    }

    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct Session {
        pub session_id: String,
        pub space_id: String,
        pub purpose: String,
        pub participants: Vec<AccountNumber>,
        pub status: u8,
        pub expires_at: i64,
        pub created_at: i64,
    }

    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct WebRtcSessionEvent {
        pub session_id: String,
        pub kind: u8,
        pub account: AccountNumber,
        pub reason: String,
    }

    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct SessionJoinAuth {
        pub session_id: String,
        pub authorized: bool,
        pub purpose: String,
        pub space_id: String,
        pub participants: Vec<AccountNumber>,
        pub status: u8,
        pub expires_at: i64,
        pub expired: bool,
    }
}

pub mod call_timeline;
pub mod sessions;
pub mod spaces;

#[psibase::service(name = "chat", tables = "tables")]
pub mod service {
    use crate::sessions;
    use crate::spaces::{
        canonical_space_members, dm_members, ensure_space, space_with_members, spaces_for_user,
        validate_group_members,
    };
    use crate::tables::{
        CallEvent, InitRow, InitTable, Session, SessionJoinAuth, Space, WebRtcSessionEvent,
    };
    use psibase::services::transact::Wrapper as TransactSvc;
    use psibase::*;

    fn now_micros() -> i64 {
        TransactSvc::call().currentBlock().time.microseconds
    }

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::read();
        table
            .get_index_pk()
            .get(&())
            .expect("service not inited");
    }

    #[action]
    #[allow(non_snake_case)]
    fn ensureSpace(members: Vec<AccountNumber>) -> Space {
        let sender = get_sender();
        let members = crate::spaces::canonical_space_members(members);
        assert!(
            crate::spaces::sender_is_member(&members, sender),
            "caller must be included in space members",
        );
        let row = ensure_space(members, now_micros()).expect("ensure space");
        space_with_members(row)
    }

    #[action]
    #[allow(non_snake_case)]
    fn ensureDm(contact: AccountNumber) -> Space {
        let sender = get_sender();
        let members = dm_members(sender, contact).expect("invalid dm members");
        let row = ensure_space(members, now_micros()).expect("ensure space");
        space_with_members(row)
    }

    #[action]
    #[allow(non_snake_case)]
    fn ensureGroup(other_members: Vec<AccountNumber>) -> Space {
        let sender = get_sender();
        let members = canonical_space_members(std::iter::once(sender).chain(other_members));
        validate_group_members(&members).expect("invalid group members");
        let row = ensure_space(members, now_micros()).expect("ensure space");
        space_with_members(row)
    }

    #[action]
    #[allow(non_snake_case)]
    fn getSpace(space_id: String) -> Option<Space> {
        crate::spaces::space_row(&space_id).map(space_with_members)
    }

    #[action]
    #[allow(non_snake_case)]
    fn isSpaceMember(space_id: String, member: AccountNumber) -> bool {
        crate::spaces::is_space_member(&space_id, member)
    }

    #[action]
    #[allow(non_snake_case)]
    fn spacesForSender() -> Vec<Space> {
        let sender = get_sender();
        spaces_for_user(sender)
            .into_iter()
            .map(space_with_members)
            .collect()
    }

    #[action]
    #[allow(non_snake_case)]
    fn createSession(space_id: String, purpose: String) -> Session {
        let sender = get_sender();
        sessions::create_session(&space_id, &purpose, sender, now_micros()).expect("createSession")
    }

    #[action]
    #[allow(non_snake_case)]
    fn closeSession(session_id: String, reason: String) {
        let sender = get_sender();
        sessions::close_session(&session_id, &reason, sender, now_micros()).expect("closeSession");
    }

    #[action]
    #[allow(non_snake_case)]
    fn webrtcSessionEvent(event: WebRtcSessionEvent) {
        assert_eq!(
            get_sender(),
            account!("x-wrtcsig"),
            "permission denied: webrtcSessionEvent only callable by x-wrtcsig",
        );
        sessions::record_webrtc_session_event(event, now_micros()).expect("webrtcSessionEvent");
    }

    #[action]
    #[allow(non_snake_case)]
    fn commitWebRtcSessionEvent(session_id: String, kind: u8, reason: String) {
        let sender = get_sender();
        sessions::commit_webrtc_session_event(
            &session_id,
            kind,
            sender,
            &reason,
            now_micros(),
        )
        .expect("commitWebRtcSessionEvent");
    }

    #[action]
    #[allow(non_snake_case)]
    fn getSession(session_id: String) -> Option<Session> {
        sessions::session_row(&session_id).map(sessions::session_with_participants)
    }

    #[action]
    #[allow(non_snake_case)]
    fn isSessionParticipant(session_id: String, account: AccountNumber) -> bool {
        sessions::is_session_participant(&session_id, account)
    }

    #[action]
    #[allow(non_snake_case)]
    fn getCallEvents(session_id: String) -> Vec<CallEvent> {
        crate::call_timeline::call_events_for_session(&session_id)
    }

    #[action]
    #[allow(non_snake_case)]
    fn authorizeSessionJoin(session_id: String, account: AccountNumber) -> SessionJoinAuth {
        sessions::authorize_session_join(&session_id, account, now_micros())
    }
}

#[cfg(test)]
mod tests;
