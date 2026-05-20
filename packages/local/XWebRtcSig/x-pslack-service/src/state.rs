use psibase::{sha256, AccountNumber, Table};
use std::cmp::Ordering;
use std::collections::BTreeMap;

use crate::protocol::{PresenceStatus, ServerFrame};

pub const CONVERSATION_KIND_DM: u8 = 1;
pub const CONVERSATION_KIND_GROUP: u8 = 2;

pub const CALL_PHASE_RINGING: u8 = 0;
pub const CALL_PHASE_CONNECTED: u8 = 1;

/// Client + server safety net (architecture §6.2, §9.2): drop stale ringing rows after this many µs.
pub const STALE_RINGING_TTL_US: i64 = 25_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StateError {
    InvalidMemberSet(String),
    UnknownConversation(String),
    NotMember(String),
}

impl StateError {
    /// Wire `code` field for `ServerFrame::Error` (architecture §9, kebab-case).
    pub fn wire_code(&self) -> &'static str {
        match self {
            StateError::InvalidMemberSet(_) => "bad-members",
            StateError::UnknownConversation(_) => "unknown-conversation",
            StateError::NotMember(_) => "not-member",
        }
    }

}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemovedSocket {
    pub socket: i32,
    pub user: AccountNumber,
    pub remaining_sockets: Vec<i32>,
}

impl RemovedSocket {
    pub fn was_final_socket(&self) -> bool {
        self.remaining_sockets.is_empty()
    }
}

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
        /// Negotiated websocket app protocol: `1` (`psibase.pslack.v1`) or `2` (`psibase.pslack.v2`).
        pub protocol_major: u8,
    }

    impl SocketSessionRow {
        #[secondary_key(1)]
        fn by_user_socket(&self) -> (AccountNumber, i32) {
            (self.user, self.socket)
        }
    }

    #[table(name = "UserSessionTable", index = 1, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct UserSessionRow {
        pub user: AccountNumber,
        pub socket: i32,
    }

    impl UserSessionRow {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, i32) {
            (self.user, self.socket)
        }
    }

    #[table(name = "ConversationTable", index = 2, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct ConversationRow {
        #[primary_key]
        pub conversation_id: String,
        pub kind: u8,
        pub created_at: i64,
    }

    #[table(name = "ConversationMemberTable", index = 3, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct ConversationMemberRow {
        pub conversation_id: String,
        pub member: AccountNumber,
    }

    impl ConversationMemberRow {
        #[primary_key]
        fn pk(&self) -> (String, AccountNumber) {
            (self.conversation_id.clone(), self.member)
        }

        #[secondary_key(1)]
        fn by_member_conversation(&self) -> (AccountNumber, String) {
            (self.member, self.conversation_id.clone())
        }
    }

    #[table(name = "MessageCounterTable", index = 4, db = "Subjective")]
    #[derive(Default, Debug, Clone, PartialEq, Eq, Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct MessageCounterRow {
        pub last_server_msg_id: u64,
    }

    impl MessageCounterRow {
        #[primary_key]
        fn pk(&self) {}
    }

    /// Transient DM call row (Milestone 2+). Primary key is an opaque service-issued `call_id`.
    #[table(name = "ActiveCallTable", index = 5, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct ActiveCallRow {
        #[primary_key]
        pub call_id: String,
        pub conversation_id: String,
        pub caller: AccountNumber,
        pub callee: AccountNumber,
        pub caller_socket: i32,
        pub callee_socket: i32,
        pub created_at: i64,
        pub last_activity_at: i64,
        /// [`CALL_PHASE_RINGING`] or [`CALL_PHASE_CONNECTED`].
        pub phase: u8,
        /// Microseconds since epoch when callee accepted; `0` while ringing.
        pub connected_at: i64,
    }

    /// At most one active (ringing or connected) call per account (architecture §9.1).
    #[table(name = "UserActiveCallTable", index = 6, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct UserActiveCallRow {
        pub user: AccountNumber,
        pub call_id: String,
    }

    impl UserActiveCallRow {
        #[primary_key]
        fn pk(&self) -> AccountNumber {
            self.user
        }
    }

    /// Maps a websocket `socket` id to an active `call_id` for fast teardown on close (architecture §9.3).
    #[table(name = "CallSocketBindingTable", index = 7, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct CallSocketBindingRow {
        #[primary_key]
        pub socket: i32,
        pub call_id: String,
    }

    /// Per-recipient targeted chat delivery dedupe for client-generated message IDs.
    #[table(name = "MessageDeliveryTable", index = 8, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct MessageDeliveryRow {
        pub conversation_id: String,
        pub client_msg_id: String,
        pub recipient: AccountNumber,
    }

    impl MessageDeliveryRow {
        #[primary_key]
        fn pk(&self) -> (String, String, AccountNumber) {
            (
                self.conversation_id.clone(),
                self.client_msg_id.clone(),
                self.recipient,
            )
        }
    }

    /// Latest targeted `say` awaiting recipient ack before the sender is notified.
    #[table(name = "TargetedSayPendingTable", index = 9, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct TargetedSayPendingRow {
        pub conversation_id: String,
        pub client_msg_id: String,
        pub server_msg_id: u64,
        pub sender: AccountNumber,
        pub target: AccountNumber,
        pub body: String,
        pub client_time: Option<i64>,
        pub server_time: i64,
    }

    impl TargetedSayPendingRow {
        #[primary_key]
        fn pk(&self) -> (String, String) {
            (self.conversation_id.clone(), self.client_msg_id.clone())
        }
    }
}

use tables::{
    ActiveCallRow, ActiveCallTable, CallSocketBindingTable, ConversationMemberRow,
    ConversationMemberTable, ConversationRow, ConversationTable, MessageCounterTable,
    MessageDeliveryRow, MessageDeliveryTable, SocketSessionRow, SocketSessionTable,
    TargetedSayPendingRow, TargetedSayPendingTable, UserActiveCallTable, UserSessionRow,
    UserSessionTable,
};

pub fn canonical_conversation_members(
    members: impl IntoIterator<Item = AccountNumber>,
) -> Vec<AccountNumber> {
    let mut members: Vec<AccountNumber> = members.into_iter().collect();
    members.sort_by_key(|member| member.value);
    members.dedup_by_key(|member| member.value);
    members
}

pub fn canonical_conversation_members_with_sender(
    sender: AccountNumber,
    members: impl IntoIterator<Item = AccountNumber>,
) -> Vec<AccountNumber> {
    canonical_conversation_members(std::iter::once(sender).chain(members))
}

pub fn validate_conversation_members(
    members: &[AccountNumber],
) -> Result<(), StateError> {
    if members.len() < 2 {
        return Err(StateError::InvalidMemberSet(
            "conversation requires at least two members".into(),
        ));
    }
    Ok(())
}

pub fn conversation_kind_for_members(members: &[AccountNumber]) -> Result<u8, StateError> {
    validate_conversation_members(members)?;
    Ok(if members.len() == 2 {
        CONVERSATION_KIND_DM
    } else {
        CONVERSATION_KIND_GROUP
    })
}

pub fn conversation_id_for_members(members: &[AccountNumber]) -> Result<String, StateError> {
    validate_conversation_members(members)?;
    let encoded_members: Vec<String> = members.iter().map(ToString::to_string).collect();
    let bytes = serde_json::to_vec(&encoded_members)
        .map_err(|err| StateError::InvalidMemberSet(err.to_string()))?;
    Ok(format!("c:{}", sha256(&bytes)))
}

pub fn dm_members(
    sender: AccountNumber,
    other: AccountNumber,
) -> Result<Vec<AccountNumber>, StateError> {
    if sender == other {
        return Err(StateError::InvalidMemberSet(
            "dm member must be a different account".into(),
        ));
    }
    Ok(canonical_conversation_members([sender, other]))
}

pub fn group_members(
    sender: AccountNumber,
    others: impl IntoIterator<Item = AccountNumber>,
) -> Result<Vec<AccountNumber>, StateError> {
    let members = canonical_conversation_members_with_sender(sender, others);
    if members.len() < 3 {
        return Err(StateError::InvalidMemberSet(
            "group conversation requires at least three members".into(),
        ));
    }
    Ok(members)
}

pub fn sender_is_member(members: &[AccountNumber], sender: AccountNumber) -> bool {
    members.iter().any(|member| *member == sender)
}

pub fn conversation_exists(conversation_id: &str) -> bool {
    ConversationTable::read()
        .get_index_pk()
        .get(&conversation_id.to_owned())
        .is_some()
}

pub fn open_conversation(
    members: Vec<AccountNumber>,
    created_at: i64,
) -> Result<ConversationRow, StateError> {
    let members = canonical_conversation_members(members);
    let kind = conversation_kind_for_members(&members)?;
    let conversation_id = conversation_id_for_members(&members)?;
    let conversation_table = ConversationTable::new();

    if let Some(existing) = conversation_table.get_index_pk().get(&conversation_id) {
        return Ok(existing);
    }

    let row = ConversationRow {
        conversation_id: conversation_id.clone(),
        kind,
        created_at,
    };
    conversation_table.put(&row).unwrap();

    let member_table = ConversationMemberTable::new();
    for member in members {
        member_table
            .put(&ConversationMemberRow {
                conversation_id: conversation_id.clone(),
                member,
            })
            .unwrap();
    }

    Ok(row)
}

pub fn ensure_sender_is_member(
    conversation_id: &str,
    sender: AccountNumber,
) -> Result<(), StateError> {
    if !conversation_exists(conversation_id) {
        return Err(StateError::UnknownConversation(format!(
            "unknown conversation {conversation_id}"
        )));
    }
    if is_conversation_member(conversation_id, sender) {
        Ok(())
    } else {
        Err(StateError::NotMember(format!(
            "account is not a member of conversation {conversation_id}"
        )))
    }
}

pub fn is_conversation_member(conversation_id: &str, member: AccountNumber) -> bool {
    ConversationMemberTable::read()
        .get_index_pk()
        .get(&(conversation_id.to_owned(), member))
        .is_some()
}

pub fn targeted_message_was_delivered(
    conversation_id: &str,
    client_msg_id: &str,
    recipient: AccountNumber,
) -> bool {
    MessageDeliveryTable::read()
        .get_index_pk()
        .get(&(conversation_id.to_owned(), client_msg_id.to_owned(), recipient))
        .is_some()
}

pub fn mark_targeted_message_delivered(
    conversation_id: &str,
    client_msg_id: &str,
    recipient: AccountNumber,
) {
    MessageDeliveryTable::new()
        .put(&MessageDeliveryRow {
            conversation_id: conversation_id.to_owned(),
            client_msg_id: client_msg_id.to_owned(),
            recipient,
        })
        .unwrap();
}

pub fn upsert_targeted_say_pending(row: TargetedSayPendingRow) {
    TargetedSayPendingTable::new().put(&row).unwrap();
}

pub fn targeted_say_pending(
    conversation_id: &str,
    client_msg_id: &str,
) -> Option<TargetedSayPendingRow> {
    TargetedSayPendingTable::read()
        .get_index_pk()
        .get(&(conversation_id.to_owned(), client_msg_id.to_owned()))
}

pub fn remove_targeted_say_pending(conversation_id: &str, client_msg_id: &str) {
    TargetedSayPendingTable::new().erase(&(conversation_id.to_owned(), client_msg_id.to_owned()));
}

pub fn complete_targeted_say_ack(
    conversation_id: &str,
    client_msg_id: &str,
    acker: AccountNumber,
) -> Result<TargetedSayPendingRow, StateError> {
    let row = targeted_say_pending(conversation_id, client_msg_id).ok_or_else(|| {
        StateError::UnknownConversation(format!(
            "no pending targeted message {client_msg_id} in {conversation_id}"
        ))
    })?;
    if row.target != acker {
        return Err(StateError::NotMember(format!(
            "account is not the targeted recipient for message {client_msg_id}"
        )));
    }
    mark_targeted_message_delivered(conversation_id, client_msg_id, acker);
    remove_targeted_say_pending(conversation_id, client_msg_id);
    Ok(row)
}

pub fn conversations_for_user(user: AccountNumber) -> Vec<ConversationRow> {
    let member_table = ConversationMemberTable::read();
    let conversation_table = ConversationTable::read();
    member_table
        .get_index_by_member_conversation()
        .iter()
        .filter(|row| row.member == user)
        .filter_map(|row| {
            conversation_table
                .get_index_pk()
                .get(&row.conversation_id)
        })
        .collect()
}

pub fn members_of(conversation_id: &str) -> Vec<AccountNumber> {
    ConversationMemberTable::read()
        .get_index_pk()
        .iter()
        .filter(|row| row.conversation_id == conversation_id)
        .map(|row| row.member)
        .collect()
}

pub fn upsert_socket_session(
    socket: i32,
    user: AccountNumber,
    now: i64,
    protocol_major: u8,
) -> bool {
    let socket_table = SocketSessionTable::new();
    let user_table = UserSessionTable::new();
    let was_offline = sessions_for_user(user).is_empty();

    if let Some(existing) = socket_table.get_index_pk().get(&socket) {
        user_table.erase(&(existing.user, socket));
    }

    socket_table
        .put(&SocketSessionRow {
            socket,
            user,
            connected_at: now,
            last_seen_at: now,
            protocol_major,
        })
        .unwrap();
    user_table.put(&UserSessionRow { user, socket }).unwrap();
    was_offline
}

pub fn sessions_for_user(user: AccountNumber) -> Vec<i32> {
    UserSessionTable::read()
        .get_index_pk()
        .iter()
        .filter(|row| row.user == user)
        .map(|row| row.socket)
        .collect()
}

pub fn active_session_accounts_except(user: AccountNumber) -> Vec<AccountNumber> {
    let mut accounts: Vec<AccountNumber> = UserSessionTable::read()
        .get_index_pk()
        .iter()
        .filter(|row| row.user != user)
        .map(|row| row.user)
        .collect();
    accounts.sort_by_key(|account| account.value);
    accounts.dedup_by_key(|account| account.value);
    accounts
}

pub fn socket_session(socket: i32) -> Option<SocketSessionRow> {
    SocketSessionTable::read().get_index_pk().get(&socket)
}

pub fn remove_socket_session(socket: i32) -> Option<RemovedSocket> {
    let socket_table = SocketSessionTable::new();
    let row = match socket_table.get_index_pk().get(&socket) {
        Some(r) => r,
        None => return None,
    };
    socket_table.erase(&socket);
    UserSessionTable::new().erase(&(row.user, socket));

    Some(RemovedSocket {
        socket,
        user: row.user,
        remaining_sockets: sessions_for_user(row.user),
    })
}

pub fn next_server_msg_id() -> u64 {
    let table = MessageCounterTable::new();
    let mut row = table.get_index_pk().get(&()).unwrap_or_default();
    row.last_server_msg_id += 1;
    let next = row.last_server_msg_id;
    table.put(&row).unwrap();
    next
}

pub fn remove_socket_from_index(
    sessions_by_socket: &mut BTreeMap<i32, AccountNumber>,
    socket: i32,
) -> Option<RemovedSocket> {
    let user = sessions_by_socket.remove(&socket)?;
    let remaining_sockets = sessions_by_socket
        .iter()
        .filter_map(|(candidate_socket, candidate_user)| {
            (*candidate_user == user).then_some(*candidate_socket)
        })
        .collect();

    Some(RemovedSocket {
        socket,
        user,
        remaining_sockets,
    })
}

/// Other accounts that share at least one conversation with `user` (architecture §6.1).
pub fn peer_accounts_for_presence(user: AccountNumber) -> Vec<AccountNumber> {
    let mut peers: Vec<AccountNumber> = conversations_for_user(user)
        .into_iter()
        .flat_map(|conv| members_of(&conv.conversation_id))
        .filter(|m| *m != user)
        .collect();
    peers.sort_by_key(|m| m.value);
    peers.dedup_by_key(|m| m.value);
    peers
}

/// Sockets of `accounts`, in one subjective transaction (for presence fanout after `openDm` / `openGroup`).
pub fn tx_snapshot_sockets_for_accounts(accounts: Vec<AccountNumber>) -> Vec<i32> {
    ::psibase::subjective_tx! {
        let mut socks = Vec::new();
        for account in accounts.iter().copied() {
            socks.extend(sessions_for_user(account));
        }
        socks
    }
}

/// `presence` frame for the opener, with current per-account socket count.
pub fn tx_presence_frame_after_open(sender: AccountNumber) -> ServerFrame {
    ::psibase::subjective_tx! {
        let n = sessions_for_user(sender).len();
        let socket_count = if n > 0 {
            Some(n as u32)
        } else {
            None
        };
        ServerFrame::Presence {
            account: sender.into(),
            status: PresenceStatus::Online,
            socket_count,
        }
    }
}

pub fn tx_remove_socket_session(socket: i32) -> Option<RemovedSocket> {
    ::psibase::subjective_tx! {
        let out = remove_socket_session(socket);
        out
    }
}

pub fn tx_presence_frame(user: AccountNumber, status: PresenceStatus) -> ServerFrame {
    ::psibase::subjective_tx! {
        let socket_count = match status {
            PresenceStatus::Online => {
                let n = sessions_for_user(user).len();
                if n > 0 {
                    Some(n as u32)
                } else {
                    None
                }
            }
            PresenceStatus::Offline => None,
        };
        ServerFrame::Presence {
            account: user.into(),
            status,
            socket_count,
        }
    }
}

pub fn tx_presence_subscriber_sockets(subject: AccountNumber) -> Vec<i32> {
    ::psibase::subjective_tx! {
        let peers = peer_accounts_for_presence(subject);
        let mut socks = Vec::new();
        for peer in peers {
            socks.extend(sessions_for_user(peer));
        }
        socks
    }
}

pub fn tx_all_presence_subscriber_sockets(subject: AccountNumber) -> Vec<i32> {
    ::psibase::subjective_tx! {
        UserSessionTable::read()
            .get_index_pk()
            .iter()
            .filter(|row| row.user != subject)
            .map(|row| row.socket)
            .collect()
    }
}

/// Deterministic socket choice for multi-tab edge cases (tests + architecture §11).
pub fn stable_pick_callee_socket(mut sockets: Vec<i32>) -> Option<i32> {
    if sockets.is_empty() {
        return None;
    }
    sockets.sort_unstable();
    Some(sockets[0])
}

/// Lexicographic ordering on `(caller, callee, created_at)` (architecture §9.1).
pub fn cmp_call_invite_tuples(
    a_caller: AccountNumber,
    a_callee: AccountNumber,
    a_created: i64,
    b_caller: AccountNumber,
    b_callee: AccountNumber,
    b_created: i64,
) -> Ordering {
    let ac = a_caller.to_string();
    let bc = b_caller.to_string();
    ac.cmp(&bc)
        .then_with(|| a_callee.to_string().cmp(&b_callee.to_string()))
        .then_with(|| a_created.cmp(&b_created))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaleCallSweepItem {
    pub call_id: String,
    pub conversation_id: String,
    pub caller: AccountNumber,
    pub callee: AccountNumber,
}

/// Pure helper for unit tests: ringing calls idle longer than [`STALE_RINGING_TTL_US`].
pub fn stale_ringing_calls_for_sweep(now: i64, rows: &[ActiveCallRow]) -> Vec<StaleCallSweepItem> {
    let cutoff = now - STALE_RINGING_TTL_US;
    rows.iter()
        .filter(|r| r.phase == CALL_PHASE_RINGING && r.last_activity_at < cutoff)
        .map(|r| StaleCallSweepItem {
            call_id: r.call_id.clone(),
            conversation_id: r.conversation_id.clone(),
            caller: r.caller,
            callee: r.callee,
        })
        .collect()
}

pub fn allocate_call_id(
    now: i64,
    client_call_id: &str,
    caller: AccountNumber,
    callee: AccountNumber,
) -> String {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&now.to_le_bytes());
    bytes.extend_from_slice(client_call_id.as_bytes());
    bytes.extend_from_slice(&caller.value.to_le_bytes());
    bytes.extend_from_slice(&callee.value.to_le_bytes());
    format!("call:{}", sha256(&bytes))
}

pub fn active_call_for_user(user: AccountNumber) -> Option<ActiveCallRow> {
    let binding = UserActiveCallTable::read()
        .get_index_pk()
        .get(&user)?;
    ActiveCallTable::read()
        .get_index_pk()
        .get(&binding.call_id)
}

pub fn call_id_for_socket(socket: i32) -> Option<String> {
    CallSocketBindingTable::read()
        .get_index_pk()
        .get(&socket)
        .map(|r| r.call_id.clone())
}

#[cfg(test)]
mod presence_graph_tests {
    use super::*;

    fn account(name: &str) -> AccountNumber {
        name.parse().unwrap()
    }

    /// Pure mirror of [`peer_accounts_for_presence`] for graphs without subjective tables.
    fn peers_from_conversations(
        user: AccountNumber,
        conversations: &[Vec<AccountNumber>],
    ) -> Vec<AccountNumber> {
        let mut peers: Vec<AccountNumber> = conversations
            .iter()
            .filter_map(|members| {
                let canon = canonical_conversation_members(members.clone());
                canon
                    .iter()
                    .any(|m| *m == user)
                    .then_some(canon.into_iter().filter(|m| *m != user))
            })
            .flatten()
            .collect();
        peers.sort_by_key(|m| m.value);
        peers.dedup_by_key(|m| m.value);
        peers
    }

    #[test]
    fn peer_presence_targets_exclude_self_and_dedupe() {
        let a = account("alice");
        let b = account("bob");
        let c = account("carol");
        let d = account("dave");

        let convs = vec![vec![a, b], vec![a, b, c], vec![c, d]];
        let peers = peers_from_conversations(a, &convs);
        assert_eq!(peers, vec![b, c]);
    }

    #[test]
    fn user_with_no_conversations_has_no_presence_peers() {
        let a = account("alice");
        let b = account("bob");
        let convs: Vec<Vec<AccountNumber>> = vec![vec![b, account("carol")]];
        assert!(peers_from_conversations(a, &convs).is_empty());
    }
}
