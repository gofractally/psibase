use psibase::Table;

use crate::sessions::{
    session_row, sessions_for_space, PURPOSE_AV_CALL, SESSION_EVENT_PARTICIPANT_JOINED,
    SESSION_EVENT_PARTICIPANT_LEFT, SESSION_EVENT_SESSION_ENDED, SESSION_EVENT_SESSION_FAILED,
};
use crate::tables::{CallEvent, SessionEventRow, SessionEventTable};

pub const SESSION_EVENT_CALL_STARTED: u8 = 5;

pub const CALL_TIMELINE_STARTED: u8 = 1;
pub const CALL_TIMELINE_PARTICIPANT_JOINED: u8 = 2;
pub const CALL_TIMELINE_PARTICIPANT_LEFT: u8 = 3;
pub const CALL_TIMELINE_FAILED: u8 = 4;
pub const CALL_TIMELINE_ENDED: u8 = 5;

fn session_events_for(session_id: &str) -> Vec<SessionEventRow> {
    SessionEventTable::read()
        .get_index_pk()
        .iter()
        .filter(|row| row.session_id == session_id)
        .collect()
}

fn map_session_event_to_call_timeline(row: &SessionEventRow) -> Option<u8> {
    match row.kind {
        SESSION_EVENT_CALL_STARTED => Some(CALL_TIMELINE_STARTED),
        SESSION_EVENT_PARTICIPANT_JOINED => Some(CALL_TIMELINE_PARTICIPANT_JOINED),
        SESSION_EVENT_PARTICIPANT_LEFT => Some(CALL_TIMELINE_PARTICIPANT_LEFT),
        SESSION_EVENT_SESSION_FAILED => Some(CALL_TIMELINE_FAILED),
        SESSION_EVENT_SESSION_ENDED => Some(CALL_TIMELINE_ENDED),
        _ => None,
    }
}

fn map_terminal_reason(reason: &str) -> &'static str {
    match reason {
        "declined" => "declined",
        "timeout" | "missed" => "missed",
        "cancelled" => "cancelled",
        _ => "ended",
    }
}

fn map_failure_reason(reason: &str) -> &'static str {
    match reason {
        "declined" => "declined",
        "timeout" | "missed" => "missed",
        "cancelled" => "cancelled",
        _ => "failed",
    }
}

/// Maps objective call timeline kind + reason to UI wire event type, if surfaced.
pub fn call_timeline_ui_event(kind: u8, reason: &str) -> Option<&'static str> {
    match kind {
        CALL_TIMELINE_STARTED => Some("started"),
        CALL_TIMELINE_ENDED => Some(map_terminal_reason(reason)),
        CALL_TIMELINE_FAILED => Some(map_failure_reason(reason)),
        CALL_TIMELINE_PARTICIPANT_JOINED | CALL_TIMELINE_PARTICIPANT_LEFT => None,
        _ => None,
    }
}

/// Derives objective call timeline semantics from stored session events for av-call.
pub fn call_events_for_session(session_id: &str) -> Vec<CallEvent> {
    let Some(session) = session_row(session_id) else {
        return vec![];
    };
    if session.purpose != PURPOSE_AV_CALL {
        return vec![];
    }

    let mut events: Vec<CallEvent> = session_events_for(session_id)
        .into_iter()
        .filter_map(|row| {
            map_session_event_to_call_timeline(&row).map(|kind| CallEvent {
                space_uuid: session.space_uuid.clone(),
                session_id: session_id.to_owned(),
                kind,
                account: row.account,
                reason: row.reason,
                at: row.at,
            })
        })
        .collect();
    events.sort_by_key(|event| (event.at, event.kind, event.account.value));
    events
}

/// All av-call timeline events for a Space (all objective sessions, any lifecycle).
pub fn call_events_for_space(space_uuid: &str) -> Vec<CallEvent> {
    let mut events: Vec<CallEvent> = sessions_for_space(space_uuid, PURPOSE_AV_CALL)
        .into_iter()
        .flat_map(|row| call_events_for_session(&row.session_id))
        .collect();
    events.sort_by_key(|event| (event.at, event.kind, event.account.value));
    events
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn map_session_event_kinds_to_call_timeline_kinds() {
        assert_eq!(
            map_session_event_to_call_timeline(&SessionEventRow {
                session_id: "wrtc:1".into(),
                kind: SESSION_EVENT_PARTICIPANT_JOINED,
                account: "bob".parse().unwrap(),
                reason: "joined".into(),
                at: 1,
            }),
            Some(CALL_TIMELINE_PARTICIPANT_JOINED)
        );
        assert_eq!(
            map_session_event_to_call_timeline(&SessionEventRow {
                session_id: "wrtc:1".into(),
                kind: SESSION_EVENT_CALL_STARTED,
                account: "alice".parse().unwrap(),
                reason: "started".into(),
                at: 0,
            }),
            Some(CALL_TIMELINE_STARTED)
        );
    }

    #[test]
    fn call_timeline_ui_event_maps_terminal_reasons() {
        assert_eq!(
            call_timeline_ui_event(CALL_TIMELINE_ENDED, "declined"),
            Some("declined")
        );
        assert_eq!(
            call_timeline_ui_event(CALL_TIMELINE_FAILED, "timeout"),
            Some("missed")
        );
        assert_eq!(
            call_timeline_ui_event(CALL_TIMELINE_PARTICIPANT_JOINED, "joined"),
            None
        );
    }
}
