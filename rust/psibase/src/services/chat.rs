#[crate::service(name = "chat", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::AccountNumber;
    use crate::Fracpack;
    use async_graphql::SimpleObject;
    use fracpack::ToSchema;
    use serde::{Deserialize, Serialize};

    #[derive(Fracpack, Serialize, Deserialize, ToSchema, SimpleObject, Debug, Clone, PartialEq, Eq)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct Space {
        pub space_id: String,
        pub members: Vec<AccountNumber>,
    }

    #[derive(Fracpack, Serialize, Deserialize, ToSchema, SimpleObject, Debug, Clone, PartialEq, Eq)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct Session {
        pub session_id: String,
        pub space_id: String,
        pub purpose: String,
        pub participants: Vec<AccountNumber>,
        pub status: u8,
        pub expires_at: i64,
        pub created_at: i64,
    }

    #[derive(Fracpack, Serialize, Deserialize, ToSchema, SimpleObject, Debug, Clone, PartialEq, Eq)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct CallEvent {
        pub space_id: String,
        pub session_id: String,
        pub kind: u8,
        pub account: AccountNumber,
        pub reason: String,
        pub at: i64,
    }

    #[derive(Fracpack, Serialize, Deserialize, ToSchema, SimpleObject, Debug, Clone, PartialEq, Eq)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct WebRtcSessionEvent {
        pub session_id: String,
        pub kind: u8,
        pub account: AccountNumber,
        pub reason: String,
    }

    #[derive(Fracpack, Serialize, Deserialize, ToSchema, SimpleObject, Debug, Clone, PartialEq, Eq)]
    #[fracpack(fracpack_mod = "fracpack")]
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

    #[action]
    fn init() {
        unimplemented!()
    }

    #[action]
    fn ensureSpace(members: Vec<AccountNumber>) -> Space {
        unimplemented!()
    }

    #[action]
    fn ensureDm(contact: AccountNumber) -> Space {
        unimplemented!()
    }

    #[action]
    fn ensureGroup(other_members: Vec<AccountNumber>) -> Space {
        unimplemented!()
    }

    #[action]
    fn getSpace(space_id: String) -> Option<Space> {
        unimplemented!()
    }

    #[action]
    fn isSpaceMember(space_id: String, member: AccountNumber) -> bool {
        unimplemented!()
    }

    #[action]
    fn spacesForSender() -> Vec<Space> {
        unimplemented!()
    }

    #[action]
    fn createSession(
        space_id: String,
        purpose: String,
        participants: Vec<AccountNumber>,
    ) -> Session {
        unimplemented!()
    }

    #[action]
    fn closeSession(session_id: String, reason: String) {
        unimplemented!()
    }

    #[action]
    fn webrtcSessionEvent(event: WebRtcSessionEvent) {
        unimplemented!()
    }

    #[action]
    fn commitWebRtcSessionEvent(session_id: String, kind: u8, reason: String) {
        unimplemented!()
    }

    #[action]
    fn getSession(session_id: String) -> Option<Session> {
        unimplemented!()
    }

    #[action]
    fn isSessionParticipant(session_id: String, account: AccountNumber) -> bool {
        unimplemented!()
    }

    #[action]
    fn getCallEvents(session_id: String) -> Vec<CallEvent> {
        unimplemented!()
    }

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
