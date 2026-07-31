use psibase::{AccountNumber, Table};

use crate::sessions::{
    session_row, sessions_for_space, PURPOSE_AV_CALL, SESSION_EVENT_CALL_STARTED,
    SESSION_EVENT_PARTICIPANT_JOINED, SESSION_EVENT_PARTICIPANT_LEFT,
    SESSION_EVENT_SESSION_ENDED, SESSION_EVENT_SESSION_FAILED,
};
use crate::tables::{CallEvent, SessionEventTable};

fn map_ui_reason(kind: u8, reason: &str) -> &'static str {
    match reason {
        "declined" => "declined",
        "timeout" | "missed" => "missed",
        "cancelled" => "cancelled",
        _ if kind == SESSION_EVENT_SESSION_FAILED => "failed",
        _ => "ended",
    }
}

/// Maps stored session-event kind + reason to UI wire event type, if surfaced.
pub fn call_timeline_ui_event(kind: u8, reason: &str) -> Option<&'static str> {
    match kind {
        SESSION_EVENT_CALL_STARTED => Some("started"),
        SESSION_EVENT_SESSION_ENDED => Some(map_ui_reason(kind, reason)),
        SESSION_EVENT_SESSION_FAILED => Some(map_ui_reason(kind, reason)),
        SESSION_EVENT_PARTICIPANT_JOINED | SESSION_EVENT_PARTICIPANT_LEFT => None,
        _ => None,
    }
}

/// Objective call timeline for an av-call session (`CallEvent.kind` == `SESSION_EVENT_*`).
pub fn call_events_for_session(session_id: &str) -> Vec<CallEvent> {
    let Some(session) = session_row(session_id) else {
        return vec![];
    };
    if session.purpose != PURPOSE_AV_CALL {
        return vec![];
    }

    let mut events: Vec<CallEvent> = SessionEventTable::read()
        .get_index_pk()
        .range(
            (
                session_id.to_owned(),
                i64::MIN,
                u8::MIN,
                AccountNumber::MIN,
            )
                ..=(
                    session_id.to_owned(),
                    i64::MAX,
                    u8::MAX,
                    AccountNumber::MAX,
                ),
        )
        .filter(|row| {
            matches!(
                row.kind,
                SESSION_EVENT_CALL_STARTED
                    | SESSION_EVENT_PARTICIPANT_JOINED
                    | SESSION_EVENT_PARTICIPANT_LEFT
                    | SESSION_EVENT_SESSION_FAILED
                    | SESSION_EVENT_SESSION_ENDED
            )
        })
        .map(|row| CallEvent {
            space_id: session.space_id.clone(),
            session_id: session_id.to_owned(),
            kind: row.kind,
            account: row.account,
            reason: row.reason,
            at: row.at,
        })
        .collect();
    events.sort_by_key(|event| (event.at, event.kind, event.account.value));
    events
}

/// All av-call timeline events for a Space (all objective sessions, any status).
pub fn call_events_for_space(space_id: &str) -> Vec<CallEvent> {
    let mut events: Vec<CallEvent> = sessions_for_space(space_id, PURPOSE_AV_CALL)
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
    fn call_timeline_ui_event_maps_terminal_reasons() {
        assert_eq!(
            call_timeline_ui_event(SESSION_EVENT_SESSION_ENDED, "declined"),
            Some("declined")
        );
        assert_eq!(
            call_timeline_ui_event(SESSION_EVENT_SESSION_FAILED, "timeout"),
            Some("missed")
        );
        assert_eq!(
            call_timeline_ui_event(SESSION_EVENT_PARTICIPANT_JOINED, "joined"),
            None
        );
        assert_eq!(
            call_timeline_ui_event(SESSION_EVENT_CALL_STARTED, "started"),
            Some("started")
        );
    }
}
