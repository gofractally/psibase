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
        pub space_uuid: String,
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
    fn webrtcSessionEvent(event: WebRtcSessionEvent) {
        unimplemented!()
    }

    #[action]
    fn commitWebRtcSessionEvent(session_id: String, kind: u8, reason: String) {
        unimplemented!()
    }

    #[action]
    fn authorizeSessionJoin(session_id: String, account: AccountNumber) -> SessionJoinAuth {
        unimplemented!()
    }
}

pub use service::{SessionJoinAuth, WebRtcSessionEvent};

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
