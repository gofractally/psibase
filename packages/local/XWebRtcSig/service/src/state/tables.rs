#[psibase::service_tables]
pub mod tables {
    use psibase::{AccountNumber, Fracpack, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "SocketSessionTable", index = 0, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct SocketSessionRow {
        #[primary_key]
        pub socket: i32,
        pub user: AccountNumber,
        pub connected_at: i64,
        pub last_seen_at: i64,
        pub client_instance_id: String,
        pub active: bool,
        pub visible: bool,
        pub supports_audio: bool,
        pub supports_video: bool,
        pub supports_data: bool,
    }

    impl SocketSessionRow {
        /// Secondary index for "all sockets for this account" (presence / fanout).
        #[secondary_key(1)]
        fn by_user_socket(&self) -> (AccountNumber, i32) {
            (self.user, self.socket)
        }
    }

    /// Live websocket join for an objective WebRTC session.
    #[table(name = "SessionJoinTable", index = 1, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct SessionJoinRow {
        pub session_id: String,
        pub account: AccountNumber,
        pub socket: i32,
        pub client_instance_id: String,
        pub joined_at: i64,
    }

    impl SessionJoinRow {
        #[primary_key]
        fn pk(&self) -> (String, AccountNumber) {
            (self.session_id.clone(), self.account)
        }

        #[secondary_key(1)]
        fn by_socket(&self) -> (i32, String) {
            (self.socket, self.session_id.clone())
        }
    }

    /// SDP/ICE queued when the recipient had no joined socket for the session.
    #[table(name = "SigPendingSignalTable", index = 2, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct SigPendingSignalRow {
        pub session_id: String,
        pub to: AccountNumber,
        pub seq: i64,
        pub payload: String,
    }

    impl SigPendingSignalRow {
        #[primary_key]
        fn pk(&self) -> (String, AccountNumber, i64) {
            (self.session_id.clone(), self.to, self.seq)
        }
    }

    /// Per-session ringing/activity clocks for the stale-ringing sweep.
    #[table(name = "SessionLivenessTable", index = 3, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct SessionLivenessRow {
        #[primary_key]
        pub session_id: String,
        pub ringing_since: i64,
        pub last_activity_at: i64,
    }

    /// Server frames queued for a socket when inline `send` would abort the
    /// active recv action (dead peer socket during join/signal fanout).
    #[table(name = "SigPendingOutboundTable", index = 4, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct SigPendingOutboundRow {
        pub target_socket: i32,
        pub seq: i64,
        pub payload: String,
    }

    impl SigPendingOutboundRow {
        #[primary_key]
        fn pk(&self) -> (i32, i64) {
            (self.target_socket, self.seq)
        }
    }
}
