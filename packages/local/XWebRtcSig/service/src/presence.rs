//! Contact-scoped presence fanout (architecture §11.2).
//!
//! M1 uses node-local online session accounts as presence peers. Clients merge
//! snapshot/delta frames with Contacts-app data (T-004); server-side Contacts
//! plugin storage is client-local and not readable from this service.

use psibase::AccountNumber;

use crate::protocol::{ContactPresence, PresenceStatus, ServerFrame};
use crate::state::{active_session_accounts_except, sessions_for_user};

/// Accounts that should receive presence deltas about `subject`.
///
/// Contact-scoped for M1: other users currently connected on this node. The UI
/// filters to Contacts-app entries when rendering the sidebar.
pub fn peer_accounts_for_presence(subject: AccountNumber) -> Vec<AccountNumber> {
    active_session_accounts_except(subject)
}

pub fn presence_status(account: AccountNumber) -> PresenceStatus {
    if sessions_for_user(account).is_empty() {
        PresenceStatus::Offline
    } else {
        PresenceStatus::Online
    }
}

fn socket_count_for_status(account: AccountNumber, status: PresenceStatus) -> Option<u32> {
    match status {
        PresenceStatus::Online => {
            let n = sessions_for_user(account).len();
            (n > 0).then_some(n as u32)
        }
        PresenceStatus::Offline => None,
    }
}

pub fn presence_delta_frame(user: AccountNumber, status: PresenceStatus) -> ServerFrame {
    ServerFrame::Presence {
        account: user.into(),
        status,
        socket_count: socket_count_for_status(user, status),
    }
}

/// Snapshot of online peers for the connecting user (architecture §5.1).
pub fn presence_snapshot_frame(for_user: AccountNumber) -> ServerFrame {
    let contacts = peer_accounts_for_presence(for_user)
        .into_iter()
        .map(|account| ContactPresence {
            account: account.into(),
            presence: presence_status(account),
        })
        .collect();
    ServerFrame::PresenceSnapshot { contacts }
}

pub fn subscriber_sockets_for_presence(subject: AccountNumber) -> Vec<i32> {
    peer_accounts_for_presence(subject)
        .into_iter()
        .flat_map(sessions_for_user)
        .collect()
}

pub struct ConnectPresenceFanout {
    pub snapshot: ServerFrame,
    pub peer_deltas: Vec<(i32, ServerFrame)>,
}

/// After a websocket session is recorded, build snapshot for the connector and
/// online deltas for contact-scoped peers.
pub fn connect_presence_fanout(user: AccountNumber) -> ConnectPresenceFanout {
    let snapshot = presence_snapshot_frame(user);
    let delta = presence_delta_frame(user, PresenceStatus::Online);
    let peer_deltas = subscriber_sockets_for_presence(user)
        .into_iter()
        .map(|socket| (socket, delta.clone()))
        .collect();
    ConnectPresenceFanout {
        snapshot,
        peer_deltas,
    }
}

pub struct DisconnectPresenceFanout {
    pub peer_deltas: Vec<(i32, ServerFrame)>,
}

/// After socket removal, fanout offline (final socket) or still-online (multi-tab).
pub fn disconnect_presence_fanout(user: AccountNumber, was_final_socket: bool) -> DisconnectPresenceFanout {
    let status = if was_final_socket {
        PresenceStatus::Offline
    } else {
        PresenceStatus::Online
    };
    let delta = presence_delta_frame(user, status);
    let peer_deltas = subscriber_sockets_for_presence(user)
        .into_iter()
        .map(|socket| (socket, delta.clone()))
        .collect();
    DisconnectPresenceFanout { peer_deltas }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Offline deltas must not touch subjective session tables (psitest has no chain db).
    #[test]
    fn presence_delta_offline_omits_socket_count() {
        use crate::protocol::{PresenceStatus, ServerFrame};

        let alice: AccountNumber = "alice".parse().unwrap();
        let frame = presence_delta_frame(alice, PresenceStatus::Offline);
        match frame {
            ServerFrame::Presence {
                status,
                socket_count,
                ..
            } => {
                assert_eq!(status, PresenceStatus::Offline);
                assert!(socket_count.is_none());
            }
            _ => panic!("expected Presence"),
        }
    }
}
