//! Node-local presence fanout.
//!
//! Presence peers are other accounts with live websockets on this node.
//! Clients merge snapshot/delta frames with Contacts-app data; Contacts
//! plugin storage is client-local and not readable from this service.

use psibase::AccountNumber;

use crate::protocol::{PeerPresence, PresenceStatus, ServerFrame};
use crate::state::{connected_accounts_except, sockets_for_user};

pub fn presence_status(account: AccountNumber) -> PresenceStatus {
    if sockets_for_user(account).is_empty() {
        PresenceStatus::Offline
    } else {
        PresenceStatus::Online
    }
}

fn socket_count_for_status(account: AccountNumber, status: PresenceStatus) -> Option<u32> {
    match status {
        PresenceStatus::Online => {
            let n = sockets_for_user(account).len();
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

/// Snapshot of online peers for the connecting user.
pub fn presence_snapshot_frame(for_user: AccountNumber) -> ServerFrame {
    let peers = connected_accounts_except(for_user)
        .into_iter()
        .map(|account| PeerPresence {
            account: account.into(),
            presence: presence_status(account),
        })
        .collect();
    ServerFrame::PresenceSnapshot { peers }
}

pub fn subscriber_sockets_for_presence(subject: AccountNumber) -> Vec<i32> {
    connected_accounts_except(subject)
        .into_iter()
        .flat_map(sockets_for_user)
        .collect()
}

pub struct ConnectPresenceFanout {
    pub snapshot: ServerFrame,
    pub peer_deltas: Vec<(i32, ServerFrame)>,
}

/// After a websocket session is recorded, build snapshot for the connector and
/// online deltas for peers with live sockets on this node.
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
