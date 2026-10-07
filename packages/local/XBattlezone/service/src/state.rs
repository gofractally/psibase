use psibase::{account, AccountNumber, ExactAccountNumber, Table};

use crate::protocol::{LobbyPlayer, PeerPresence, PresenceStatus, RosterSlot, ServerFrame};

#[psibase::service_tables]
pub mod tables {
    use psibase::{AccountNumber, Pack, ToSchema, Unpack};
    use serde::{Deserialize, Serialize};

    #[table(name = "SocketTable", index = 0, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Pack, Unpack, Serialize, Deserialize, ToSchema)]
    pub struct SocketRow {
        #[primary_key]
        pub socket: i32,
        pub user: AccountNumber,
        pub connected_at: i64,
    }

    impl SocketRow {
        #[secondary_key(1)]
        fn by_user_socket(&self) -> (AccountNumber, i32) {
            (self.user, self.socket)
        }
    }

    #[table(name = "TicketTable", index = 1, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Pack, Unpack, Serialize, Deserialize, ToSchema)]
    pub struct TicketRow {
        #[primary_key]
        pub ticket: String,
        pub user: AccountNumber,
        pub app: AccountNumber,
        pub expires_at: i64,
    }

    #[table(name = "MatchTable", index = 2, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Pack, Unpack, Serialize, Deserialize, ToSchema)]
    pub struct MatchRow {
        #[primary_key]
        pub id: u8,
        pub host: AccountNumber,
        pub host_socket: i32,
        pub enemy_count: u8,
        /// JSON-encoded Vec<RosterSlotWire>
        pub roster_json: String,
    }

    #[table(name = "TicketSeqTable", index = 3, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Pack, Unpack, Serialize, Deserialize, ToSchema)]
    pub struct TicketSeqRow {
        #[primary_key]
        pub id: u8,
        pub next: u64,
    }

    /// Accounts that have pressed Enter in the waiting room.
    #[table(name = "ReadyTable", index = 4, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Pack, Unpack, Serialize, Deserialize, ToSchema)]
    pub struct ReadyRow {
        #[primary_key]
        pub user: AccountNumber,
    }

    /// Pending match settings owned by the first player who readied.
    #[table(name = "LobbyTable", index = 5, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Pack, Unpack, Serialize, Deserialize, ToSchema)]
    pub struct LobbyRow {
        #[primary_key]
        pub id: u8,
        pub host: AccountNumber,
        pub enemy_count: u8,
        /// JSON-encoded Vec<String> of "ai" / "human"
        pub slots_json: String,
    }
}

use tables::{
    LobbyRow, LobbyTable, MatchRow, MatchTable, ReadyRow, ReadyTable, SocketRow, SocketTable,
    TicketRow, TicketSeqRow, TicketSeqTable, TicketTable,
};

pub const BATTLEZONE_APP: AccountNumber = account!("battlezone");
pub const TICKET_TTL_US: i64 = 60_000_000; // 60s
const MATCH_ID: u8 = 0;
const LOBBY_ID: u8 = 0;
const SEQ_ID: u8 = 0;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RosterWire {
    tank_id: String,
    controller: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    account: Option<ExactAccountNumber>,
}

pub fn upsert_socket(socket: i32, user: AccountNumber, now: i64) {
    SocketTable::read_write()
        .put(&SocketRow {
            socket,
            user,
            connected_at: now,
        })
        .unwrap();
}

pub struct RemovedSocket {
    pub user: AccountNumber,
    pub was_final: bool,
}

pub fn close_socket(socket: i32) -> Option<RemovedSocket> {
    let table = SocketTable::read_write();
    let row = table.get_index_pk().get(&socket)?;
    table.erase(&socket);
    let remaining = user_sockets(row.user).len();
    // No clients left — drop lobby/match so reconnects don't auto-jump in.
    if SocketTable::read().get_index_pk().iter().next().is_none() {
        clear_lobby();
        clear_match();
    }
    Some(RemovedSocket {
        user: row.user,
        was_final: remaining == 0,
    })
}

/// Drop a match whose host is no longer connected.
pub fn clear_match_if_host_gone() -> bool {
    let Some(m) = get_match() else {
        return false;
    };
    if user_sockets(m.host).is_empty() {
        clear_match();
        clear_lobby();
        true
    } else {
        false
    }
}

pub fn get_socket(socket: i32) -> Option<SocketRow> {
    SocketTable::read().get_index_pk().get(&socket)
}

pub fn user_sockets(user: AccountNumber) -> Vec<i32> {
    SocketTable::read()
        .get_index_by_user_socket()
        .range((user, i32::MIN)..=(user, i32::MAX))
        .map(|r| r.socket)
        .collect()
}

pub fn other_connected_accounts(except: AccountNumber) -> Vec<AccountNumber> {
    let mut seen = Vec::new();
    for row in SocketTable::read().get_index_pk().iter() {
        if row.user == except {
            continue;
        }
        if !seen.contains(&row.user) {
            seen.push(row.user);
        }
    }
    seen
}

pub fn all_sockets_except(except: i32) -> Vec<i32> {
    SocketTable::read()
        .get_index_pk()
        .iter()
        .map(|r| r.socket)
        .filter(|s| *s != except)
        .collect()
}

pub fn mint_ticket(user: AccountNumber, app: AccountNumber, now: i64) -> String {
    let seq_table = TicketSeqTable::read_write();
    let mut seq = seq_table
        .get_index_pk()
        .get(&SEQ_ID)
        .unwrap_or(TicketSeqRow {
            id: SEQ_ID,
            next: 1,
        });
    let n = seq.next;
    seq.next = seq.next.saturating_add(1);
    seq_table.put(&seq).unwrap();

    let ticket = format!("{:x}-{:x}-{:x}", user.value, now as u64, n);
    TicketTable::read_write()
        .put(&TicketRow {
            ticket: ticket.clone(),
            user,
            app,
            expires_at: now + TICKET_TTL_US,
        })
        .unwrap();
    ticket
}

pub fn consume_ticket(ticket: &str, now: i64) -> Option<(AccountNumber, AccountNumber)> {
    let table = TicketTable::read_write();
    let row = table.get_index_pk().get(&ticket.to_string())?;
    table.erase(&ticket.to_string());
    if row.expires_at < now {
        return None;
    }
    Some((row.user, row.app))
}

fn roster_from_json(json: &str) -> Vec<RosterSlot> {
    let wire: Vec<RosterWire> = serde_json::from_str(json).unwrap_or_default();
    wire.into_iter()
        .map(|w| RosterSlot {
            tank_id: w.tank_id,
            controller: w.controller,
            account: w.account,
        })
        .collect()
}

fn roster_to_json(roster: &[RosterSlot]) -> String {
    let wire: Vec<RosterWire> = roster
        .iter()
        .map(|r| RosterWire {
            tank_id: r.tank_id.clone(),
            controller: r.controller.clone(),
            account: r.account,
        })
        .collect();
    serde_json::to_string(&wire).unwrap_or_else(|_| "[]".into())
}

fn slot_wants_human(slot_modes: &[String], index: usize) -> bool {
    slot_modes
        .get(index)
        .map(|m| m.eq_ignore_ascii_case("human"))
        .unwrap_or(false)
}

pub fn build_roster(
    host: AccountNumber,
    enemy_count: u8,
    slot_modes: &[String],
    available_humans: &[(AccountNumber, i32)],
) -> Vec<RosterSlot> {
    let mut roster = vec![RosterSlot {
        tank_id: "player".into(),
        controller: "local".into(),
        account: Some(host.into()),
    }];
    let count = enemy_count.clamp(1, 5) as usize;
    let mut human_idx = 0usize;
    for i in 0..count {
        let want_human = slot_wants_human(slot_modes, i);
        if want_human {
            if let Some((acct, _)) = available_humans.get(human_idx) {
                human_idx += 1;
                roster.push(RosterSlot {
                    tank_id: format!("ai-{i}"),
                    controller: "remote".into(),
                    account: Some((*acct).into()),
                });
                continue;
            }
        }
        // AI slot, or human slot with no remaining live peer
        roster.push(RosterSlot {
            tank_id: format!("ai-{i}"),
            controller: "ai".into(),
            account: None,
        });
    }
    roster
}

pub fn start_match(
    host: AccountNumber,
    host_socket: i32,
    enemy_count: u8,
    slot_modes: &[String],
    available_humans: &[(AccountNumber, i32)],
) -> Vec<RosterSlot> {
    let roster = build_roster(host, enemy_count, slot_modes, available_humans);
    MatchTable::read_write()
        .put(&MatchRow {
            id: MATCH_ID,
            host,
            host_socket,
            enemy_count: enemy_count.clamp(1, 5),
            roster_json: roster_to_json(&roster),
        })
        .unwrap();
    roster
}

pub fn clear_match() {
    MatchTable::read_write().erase(&MATCH_ID);
}

pub fn get_match() -> Option<MatchRow> {
    MatchTable::read().get_index_pk().get(&MATCH_ID)
}

fn slots_to_json(slots: &[String]) -> String {
    serde_json::to_string(slots).unwrap_or_else(|_| "[]".into())
}

fn slots_from_json(json: &str) -> Vec<String> {
    serde_json::from_str(json).unwrap_or_default()
}

pub fn get_lobby() -> Option<LobbyRow> {
    LobbyTable::read().get_index_pk().get(&LOBBY_ID)
}

pub fn clear_lobby() {
    LobbyTable::read_write().erase(&LOBBY_ID);
    let ready = ReadyTable::read_write();
    for row in ReadyTable::read().get_index_pk().iter() {
        ready.erase(&row.user);
    }
}

pub fn clear_ready(user: AccountNumber) {
    ReadyTable::read_write().erase(&user);
}

pub fn is_ready(user: AccountNumber) -> bool {
    ReadyTable::read().get_index_pk().get(&user).is_some()
}

/// Unique connected accounts, earliest connection first.
pub fn connected_accounts_ordered() -> Vec<AccountNumber> {
    let mut rows: Vec<SocketRow> = SocketTable::read().get_index_pk().iter().collect();
    rows.sort_by_key(|r| (r.connected_at, r.socket));
    let mut out = Vec::new();
    for row in rows {
        if !out.contains(&row.user) {
            out.push(row.user);
        }
    }
    out
}

pub fn lobby_frame() -> Option<ServerFrame> {
    let lobby = get_lobby()?;
    let slots = slots_from_json(&lobby.slots_json);
    let players = connected_accounts_ordered()
        .into_iter()
        .map(|account| LobbyPlayer {
            account: account.into(),
            ready: is_ready(account),
        })
        .collect();
    Some(ServerFrame::Lobby {
        host: lobby.host.into(),
        enemy_count: lobby.enemy_count,
        slots,
        players,
    })
}

/// Mark ready / create lobby. Returns (lobby snapshot, optional matchStarted).
pub fn set_ready(
    user: AccountNumber,
    user_socket: i32,
    enemy_count: u8,
    slots: &[String],
) -> (ServerFrame, Option<(ServerFrame, Vec<i32>)>) {
    let enemy_count = enemy_count.clamp(1, 5);
    if get_lobby().is_none() {
        // Opening a waiting room abandons any leftover match from a prior game.
        clear_match();
        LobbyTable::read_write()
            .put(&LobbyRow {
                id: LOBBY_ID,
                host: user,
                enemy_count,
                slots_json: slots_to_json(slots),
            })
            .unwrap();
    } else if let Some(mut lobby) = get_lobby() {
        // Lobby host may update config while waiting.
        if lobby.host == user {
            lobby.enemy_count = enemy_count;
            lobby.slots_json = slots_to_json(slots);
            LobbyTable::read_write().put(&lobby).unwrap();
        }
    }

    ReadyTable::read_write().put(&ReadyRow { user }).unwrap();

    let Some(lobby_row) = get_lobby() else {
        return (
            ServerFrame::Error {
                code: "lobby".into(),
                reason: "lobby missing".into(),
            },
            None,
        );
    };
    let slot_modes = slots_from_json(&lobby_row.slots_json);
    let human_slots = slot_modes
        .iter()
        .filter(|m| m.eq_ignore_ascii_case("human"))
        .count();

    let accounts = connected_accounts_ordered();
    let all_ready = !accounts.is_empty() && accounts.iter().all(|a| is_ready(*a));
    // Human slots need live peers — do not start a 1-player match that
    // would skip the waiting room (second player would join mid-game).
    let enough_players = if human_slots == 0 {
        true
    } else {
        accounts.len() >= 1 + human_slots
    };

    let lobby = lobby_frame().unwrap_or(ServerFrame::Error {
        code: "lobby".into(),
        reason: "lobby missing".into(),
    });

    if !all_ready || !enough_players {
        return (lobby, None);
    }

    let host = lobby_row.host;
    let host_socket = user_sockets(host).into_iter().next().unwrap_or(user_socket);
    let available_humans: Vec<(AccountNumber, i32)> = accounts
        .into_iter()
        .filter(|a| *a != host)
        .filter_map(|a| user_sockets(a).into_iter().next().map(|s| (a, s)))
        .collect();
    let roster = start_match(
        host,
        host_socket,
        lobby_row.enemy_count,
        &slot_modes,
        &available_humans,
    );
    let started = ServerFrame::MatchStarted {
        host: host.into(),
        enemy_count: lobby_row.enemy_count.clamp(1, 5),
        roster,
    };
    clear_lobby();
    let targets = all_sockets_except(-1);
    (lobby, Some((started, targets)))
}

pub fn set_unready(user: AccountNumber) -> Option<ServerFrame> {
    if get_match().is_some() {
        return None;
    }
    clear_ready(user);
    let Some(lobby) = get_lobby() else {
        return None;
    };
    // If host unreadies and nobody else is ready, drop the lobby.
    let any_ready = connected_accounts_ordered()
        .into_iter()
        .any(|a| is_ready(a));
    if !any_ready {
        clear_lobby();
        // Synthetic empty lobby so clients leave waiting UI: host self, no ready.
        return Some(ServerFrame::Lobby {
            host: lobby.host.into(),
            enemy_count: lobby.enemy_count,
            slots: slots_from_json(&lobby.slots_json),
            players: connected_accounts_ordered()
                .into_iter()
                .map(|account| LobbyPlayer {
                    account: account.into(),
                    ready: false,
                })
                .collect(),
        });
    }
    if lobby.host == user {
        // Keep lobby settings; host just unreadied.
    }
    lobby_frame()
}

pub fn match_roster() -> Option<Vec<RosterSlot>> {
    get_match().map(|m| roster_from_json(&m.roster_json))
}

pub fn tank_id_for_account(account: AccountNumber) -> Option<String> {
    let roster = match_roster()?;
    roster
        .into_iter()
        .find(|s| {
            s.account
                .map(|a| AccountNumber::from(a) == account)
                .unwrap_or(false)
        })
        .map(|s| s.tank_id)
}

pub fn presence_snapshot(for_user: AccountNumber) -> ServerFrame {
    let peers = other_connected_accounts(for_user)
        .into_iter()
        .map(|account| PeerPresence {
            account: account.into(),
            presence: PresenceStatus::Online,
        })
        .collect();
    ServerFrame::PresenceSnapshot { peers }
}

pub fn presence_delta(user: AccountNumber, status: PresenceStatus) -> ServerFrame {
    ServerFrame::Presence {
        account: user.into(),
        status,
    }
}

pub fn peer_sockets_for_presence(subject: AccountNumber) -> Vec<i32> {
    other_connected_accounts(subject)
        .into_iter()
        .flat_map(user_sockets)
        .collect()
}

/// On disconnect during a match: convert that human's slot back to AI.
pub fn revert_slot_to_ai(account: AccountNumber) -> Option<Vec<RosterSlot>> {
    let Some(mut row) = get_match() else {
        return None;
    };
    let mut roster = roster_from_json(&row.roster_json);
    let mut changed = false;
    for slot in &mut roster {
        if slot
            .account
            .map(|a| AccountNumber::from(a) == account)
            .unwrap_or(false)
            && slot.tank_id != "player"
        {
            slot.controller = "ai".into();
            slot.account = None;
            changed = true;
        }
    }
    if !changed {
        return None;
    }
    // If host left, end match
    if row.host == account {
        clear_match();
        return Some(vec![]);
    }
    row.roster_json = roster_to_json(&roster);
    MatchTable::read_write().put(&row).unwrap();
    Some(roster)
}

// --- subjective_tx wrappers (macro must be used as a block, not `let x = macro!(...)`) ---

pub fn get_socket_tx(socket: i32) -> Option<SocketRow> {
    ::psibase::subjective_tx! {
        get_socket(socket)
    }
}

pub fn mint_ticket_tx(user: AccountNumber, app: AccountNumber, now: i64) -> String {
    ::psibase::subjective_tx! {
        mint_ticket(user, app, now)
    }
}

pub fn consume_ticket_tx(ticket: &str, now: i64) -> Option<(AccountNumber, AccountNumber)> {
    ::psibase::subjective_tx! {
        consume_ticket(ticket, now)
    }
}

pub fn connect_tx(
    socket: i32,
    user: AccountNumber,
    now: i64,
) -> (ServerFrame, Vec<(i32, ServerFrame)>) {
    ::psibase::subjective_tx! {
        upsert_socket(socket, user, now);
        // First live client after an empty room: drop leftover match/lobby so
        // the title screen is not skipped on reconnect.
        if connected_accounts_ordered().len() == 1 {
            clear_match();
            clear_lobby();
        } else {
            clear_match_if_host_gone();
        }
        let snapshot = presence_snapshot(user);
        let delta = presence_delta(user, PresenceStatus::Online);
        let peer_deltas: Vec<(i32, ServerFrame)> = peer_sockets_for_presence(user)
            .into_iter()
            .map(|s| (s, delta.clone()))
            .collect();
        (snapshot, peer_deltas)
    }
}

pub fn all_sockets_except_tx(except: i32) -> Vec<i32> {
    ::psibase::subjective_tx! {
        all_sockets_except(except)
    }
}

pub fn clear_match_if_host_tx(user: AccountNumber) {
    ::psibase::subjective_tx! {
        if let Some(m) = get_match() {
            if m.host == user {
                clear_match();
            }
        }
    }
}

pub fn input_route_tx(user: AccountNumber, tank_id: &str) -> (bool, Option<i32>) {
    ::psibase::subjective_tx! {
        let assigned = tank_id_for_account(user);
        let m = get_match();
        (
            assigned.as_deref() == Some(tank_id),
            m.map(|m| m.host_socket),
        )
    }
}

pub fn is_host_socket_tx(user: AccountNumber, socket: i32) -> bool {
    ::psibase::subjective_tx! {
        get_match()
            .map(|m| m.host == user && m.host_socket == socket)
            .unwrap_or(false)
    }
}

/// Cleanup on socket close. Returns (removed, roster_update, host_left, lobby_frame).
pub fn cleanup_tx(
    socket: i32,
) -> (
    Option<RemovedSocket>,
    Option<Vec<RosterSlot>>,
    bool,
    Option<ServerFrame>,
) {
    ::psibase::subjective_tx! {
        let removed = close_socket(socket);
        let mut roster_update = None;
        let mut host_left = false;
        let mut lobby_update = None;
        if let Some(ref r) = removed {
            if r.was_final {
                clear_ready(r.user);
                if let Some(lobby) = get_lobby() {
                    if lobby.host == r.user {
                        // Host left waiting room — dissolve lobby.
                        clear_lobby();
                        lobby_update = Some(ServerFrame::Lobby {
                            host: lobby.host.into(),
                            enemy_count: lobby.enemy_count,
                            slots: slots_from_json(&lobby.slots_json),
                            players: connected_accounts_ordered()
                                .into_iter()
                                .map(|account| LobbyPlayer {
                                    account: account.into(),
                                    ready: false,
                                })
                                .collect(),
                        });
                    } else {
                        lobby_update = lobby_frame();
                    }
                }
            }
            if let Some(roster) = revert_slot_to_ai(r.user) {
                if roster.is_empty() {
                    host_left = true;
                } else {
                    roster_update = Some(roster);
                }
            }
        }
        (removed, roster_update, host_left, lobby_update)
    }
}

pub fn set_ready_tx(
    user: AccountNumber,
    user_socket: i32,
    enemy_count: u8,
    slots: &[String],
) -> (ServerFrame, Option<(ServerFrame, Vec<i32>)>) {
    ::psibase::subjective_tx! {
        set_ready(user, user_socket, enemy_count, slots)
    }
}

pub fn set_unready_tx(user: AccountNumber) -> Option<ServerFrame> {
    ::psibase::subjective_tx! {
        set_unready(user)
    }
}

pub fn lobby_frame_tx() -> Option<ServerFrame> {
    ::psibase::subjective_tx! {
        lobby_frame()
    }
}

pub fn clear_lobby_tx() {
    ::psibase::subjective_tx! {
        clear_lobby()
    }
}

pub fn peer_sockets_for_presence_tx(subject: AccountNumber) -> Vec<i32> {
    ::psibase::subjective_tx! {
        peer_sockets_for_presence(subject)
    }
}
