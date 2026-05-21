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
        pub space_uuid: String,
        pub kind: u8,
        pub created_at: i64,
    }

    #[table(name = "SpaceMemberTable", index = 2)]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, ToSchema, Serialize, Deserialize)]
    pub struct SpaceMemberRow {
        pub space_uuid: String,
        pub member: AccountNumber,
    }

    impl SpaceMemberRow {
        #[primary_key]
        fn pk(&self) -> (String, AccountNumber) {
            (self.space_uuid.clone(), self.member)
        }

        #[secondary_key(1)]
        fn by_member_space(&self) -> (AccountNumber, String) {
            (self.member, self.space_uuid.clone())
        }
    }

    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct Space {
        pub space_uuid: String,
        pub members: Vec<AccountNumber>,
    }

    #[table(name = "SessionTable", index = 3)]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, ToSchema, Serialize, Deserialize)]
    pub struct SessionRow {
        #[primary_key]
        pub session_id: String,
        pub space_uuid: String,
        pub purpose: String,
        pub lifecycle: u8,
        pub created_at: i64,
        pub expires_at: i64,
        pub created_by: AccountNumber,
    }

    impl SessionRow {
        #[secondary_key(1)]
        fn by_space_purpose(&self) -> (String, String) {
            (self.space_uuid.clone(), self.purpose.clone())
        }
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
            (
                self.session_id.clone(),
                self.at,
                self.kind,
                self.account,
            )
        }
    }

    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct CallEvent {
        pub space_uuid: String,
        pub session_id: String,
        pub kind: u8,
        pub account: AccountNumber,
        pub reason: String,
        pub at: i64,
    }

    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct Session {
        pub session_id: String,
        pub space_uuid: String,
        pub purpose: String,
        pub participants: Vec<AccountNumber>,
        pub lifecycle: u8,
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
        pub space_uuid: String,
        pub participants: Vec<AccountNumber>,
        pub lifecycle: u8,
        pub expires_at: i64,
        pub expired: bool,
    }
}

pub mod call_timeline;
pub mod sessions;
pub mod spaces;

#[psibase::service(name = "chat", tables = "tables")]
pub mod service {
    use crate::spaces::{
        dm_members, group_members, open_space, space_with_members, spaces_for_user,
        validate_group_members, SpaceError,
    };
    use crate::sessions::{self, SessionError};
    use crate::tables::{CallEvent, InitRow, InitTable, Session, SessionJoinAuth, Space, WebRtcSessionEvent};
    use psibase::services::transact::Wrapper as TransactSvc;
    use psibase::*;

    fn now_micros() -> i64 {
        TransactSvc::call()
            .currentBlock()
            .time
            .seconds()
            .microseconds()
            .microseconds
    }

    fn abort_on_space_err(result: Result<(), SpaceError>) {
        if let Err(err) = result {
            abort_message(&err.message());
        }
    }

    fn abort_on_session_err<T>(result: Result<T, SessionError>) -> T {
        match result {
            Ok(value) => value,
            Err(err) => abort_message(&err.message()),
        }
    }

    fn session_view(session: sessions::Session) -> Session {
        Session {
            session_id: session.session_id,
            space_uuid: session.space_uuid,
            purpose: session.purpose,
            participants: session.participants,
            lifecycle: session.lifecycle,
            expires_at: session.expires_at,
            created_at: session.created_at,
        }
    }

    fn open_space_or_abort(members: Vec<AccountNumber>) -> crate::tables::SpaceRow {
        match open_space(members, now_micros()) {
            Ok(row) => row,
            Err(err) => abort_message(&err.message()),
        }
    }

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::read();
        check(
            table.get_index_pk().get(&()).is_some(),
            "service not inited",
        );
    }

    #[action]
    #[allow(non_snake_case)]
    fn ensureSpace(members: Vec<AccountNumber>) -> Space {
        let sender = get_sender();
        let members = crate::spaces::canonical_space_members(members);
        check(
            crate::spaces::sender_is_member(&members, sender),
            "caller must be included in space members",
        );
        let row = open_space_or_abort(members);
        space_with_members(row)
    }

    #[action]
    #[allow(non_snake_case)]
    fn ensureDm(contact: AccountNumber) -> Space {
        let sender = get_sender();
        let members = match dm_members(sender, contact) {
            Ok(m) => m,
            Err(err) => abort_message(&err.message()),
        };
        let row = open_space_or_abort(members);
        space_with_members(row)
    }

    #[action]
    #[allow(non_snake_case)]
    fn ensureGroup(other_members: Vec<AccountNumber>) -> Space {
        let sender = get_sender();
        let members = group_members(sender, other_members);
        abort_on_space_err(validate_group_members(&members));
        let row = open_space_or_abort(members);
        space_with_members(row)
    }

    #[action]
    #[allow(non_snake_case)]
    fn getSpace(space_uuid: String) -> Option<Space> {
        let row = crate::tables::SpaceTable::read()
            .get_index_pk()
            .get(&space_uuid)?;
        Some(space_with_members(row))
    }

    #[action]
    #[allow(non_snake_case)]
    fn isSpaceMember(space_uuid: String, member: AccountNumber) -> bool {
        crate::spaces::is_space_member(&space_uuid, member)
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
    fn createSession(
        space_uuid: String,
        purpose: String,
        participants: Vec<AccountNumber>,
    ) -> Session {
        let sender = get_sender();
        let session = abort_on_session_err(sessions::create_session(
            &space_uuid,
            &purpose,
            participants,
            sender,
            now_micros(),
        ));
        session_view(session)
    }

    #[action]
    #[allow(non_snake_case)]
    fn closeSession(session_id: String, reason: String) {
        let sender = get_sender();
        abort_on_session_err(sessions::close_session(
            &session_id,
            &reason,
            sender,
            now_micros(),
        ));
    }

    #[action]
    #[allow(non_snake_case)]
    fn webrtcSessionEvent(event: WebRtcSessionEvent) {
        check(
            get_sender() == account!("x-webrtcsig"),
            "permission denied: webrtcSessionEvent only callable by x-webrtcsig",
        );
        abort_on_session_err(sessions::apply_webrtc_session_event(
            sessions::WebRtcSessionEvent {
                session_id: event.session_id,
                kind: event.kind,
                account: event.account,
                reason: event.reason,
            },
            now_micros(),
        ));
    }

    #[action]
    #[allow(non_snake_case)]
    fn commitWebRtcSessionEvent(session_id: String, kind: u8, reason: String) {
        let sender = get_sender();
        abort_on_session_err(sessions::commit_webrtc_session_event(
            &session_id,
            kind,
            sender,
            &reason,
            now_micros(),
        ));
    }

    #[action]
    #[allow(non_snake_case)]
    fn getSession(session_id: String) -> Option<Session> {
        sessions::session_row(&session_id).map(|row| session_view(sessions::session_to_view(row)))
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
        let auth = sessions::authorize_session_join(&session_id, account, now_micros());
        SessionJoinAuth {
            session_id: auth.session_id,
            authorized: auth.authorized,
            purpose: auth.purpose,
            space_uuid: auth.space_uuid,
            participants: auth.participants,
            lifecycle: auth.lifecycle,
            expires_at: auth.expires_at,
            expired: auth.expired,
        }
    }
}

#[cfg(test)]
mod tests;
