//! Stale ringing/session sweep and subjective cleanup.

use psibase::services::chat;
use psibase::AccountNumber;

use crate::protocol::ServerFrame;
use crate::signaling::{
    query_session_auth_for_cleanup, EVENT_SESSION_ENDED, EVENT_SESSION_FAILED, PURPOSE_AV_CALL,
};
use crate::state::{
    cleanup_all_subjective_for_session, joined_accounts_for_session, known_sig_session_ids,
    sig_joins_for_session, sig_session_track, STALE_RINGING_TTL_US,
};

const SESSION_STATUS_ACTIVE: u8 = 1;

fn session_last_activity_at(session_id: &str, now: i64) -> i64 {
    if let Some(track) = sig_session_track(session_id) {
        return track.last_activity_at;
    }
    sig_joins_for_session(session_id)
        .into_iter()
        .map(|row| row.joined_at)
        .min()
        .unwrap_or(now)
}

fn session_ringing_started_at(session_id: &str, now: i64) -> i64 {
    if let Some(track) = sig_session_track(session_id) {
        return track.ringing_since;
    }
    session_last_activity_at(session_id, now)
}

fn is_ringing_av_call(auth: &chat::SessionJoinAuth, session_id: &str) -> bool {
    auth.purpose == PURPOSE_AV_CALL
        && auth.status == SESSION_STATUS_ACTIVE
        && !auth.expired
        && joined_accounts_for_session(session_id).len() < auth.participants.len()
}

/// Account to put in `SessionEnded.by` when the server force-ends a session
/// (prefer first unjoined participant, else first participant, else `x-wrtcsig`).
fn get_who_terminated_session(
    participants: &[AccountNumber],
    joined: &[AccountNumber],
) -> AccountNumber {
    participants
        .iter()
        .find(|p| !joined.iter().any(|j| j == *p))
        .copied()
        .or_else(|| participants.first().copied())
        .unwrap_or_else(|| psibase::account!("x-wrtcsig"))
}

fn fanout_session_ended(
    participants: &[AccountNumber],
    session_id: &str,
    by: AccountNumber,
    reason: &str,
) -> Vec<(i32, ServerFrame)> {
    let frame = ServerFrame::SessionEnded {
        session_id: session_id.to_owned(),
        by: by.into(),
        reason: reason.to_owned(),
    };
    crate::signaling::fanout_session_ended_to_participants(participants, &frame)
}

fn end_and_purge_session(
    session_id: &str,
    auth: &chat::SessionJoinAuth,
    reason: &str,
) -> Vec<(i32, ServerFrame)> {
    let by = get_who_terminated_session(
        &auth.participants,
        &joined_accounts_for_session(session_id),
    );
    let out = fanout_session_ended(&auth.participants, session_id, by, reason);
    cleanup_all_subjective_for_session(session_id);
    out
}

fn sweep_one_session(session_id: &str, now: i64) -> Vec<(i32, ServerFrame)> {
    let auth = query_session_auth_for_cleanup(session_id);
    if auth.purpose.is_empty() {
        cleanup_all_subjective_for_session(session_id);
        return vec![];
    }

    if auth.expired || auth.status != SESSION_STATUS_ACTIVE {
        if !joined_accounts_for_session(session_id).is_empty()
            || sig_session_track(session_id).is_some()
        {
            let reason = if auth.expired {
                "expired"
            } else {
                "session-not-active"
            };
            return end_and_purge_session(session_id, &auth, reason);
        }
        cleanup_all_subjective_for_session(session_id);
        return vec![];
    }

    if !is_ringing_av_call(&auth, session_id) {
        return vec![];
    }

    let cutoff = now - STALE_RINGING_TTL_US;
    let stale_at = session_last_activity_at(session_id, now);
    let ringing_since = session_ringing_started_at(session_id, now);
    if stale_at >= cutoff && ringing_since >= cutoff {
        return vec![];
    }

    end_and_purge_session(session_id, &auth, "timeout")
}

pub(crate) fn sweep_all_known_sessions(now: i64) -> Vec<(i32, ServerFrame)> {
    let mut out = Vec::new();
    for session_id in known_sig_session_ids() {
        out.extend(sweep_one_session(&session_id, now));
    }
    out
}

pub fn purge_session_if_fully_ended(session_id: &str, event_kind: u8) {
    if event_kind == EVENT_SESSION_ENDED || event_kind == EVENT_SESSION_FAILED {
        cleanup_all_subjective_for_session(session_id);
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;
    use psibase::*;

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct SweepCandidate {
        session_id: String,
        purpose: String,
        status: u8,
        expired: bool,
        participants: usize,
        joined: usize,
        last_activity_at: i64,
        ringing_since: i64,
    }

    fn should_sweep_ringing_av_call(candidate: &SweepCandidate, now: i64) -> bool {
        candidate.purpose == PURPOSE_AV_CALL
            && candidate.status == SESSION_STATUS_ACTIVE
            && !candidate.expired
            && candidate.joined < candidate.participants
            && candidate.last_activity_at < now - STALE_RINGING_TTL_US
    }

    #[test]
    fn stale_ringing_av_call_is_sweepable() {
        let now = 100_000_000;
        let candidate = SweepCandidate {
            session_id: "wrtc:1".into(),
            purpose: PURPOSE_AV_CALL.into(),
            status: SESSION_STATUS_ACTIVE,
            expired: false,
            participants: 2,
            joined: 1,
            last_activity_at: now - STALE_RINGING_TTL_US - 1,
            ringing_since: now - STALE_RINGING_TTL_US - 1,
        };
        assert!(should_sweep_ringing_av_call(&candidate, now));
    }

    #[test]
    fn connected_av_call_is_not_sweepable() {
        let now = 100_000_000;
        let candidate = SweepCandidate {
            session_id: "wrtc:2".into(),
            purpose: PURPOSE_AV_CALL.into(),
            status: SESSION_STATUS_ACTIVE,
            expired: false,
            participants: 2,
            joined: 2,
            last_activity_at: now - STALE_RINGING_TTL_US - 1,
            ringing_since: now - STALE_RINGING_TTL_US - 1,
        };
        assert!(!should_sweep_ringing_av_call(&candidate, now));
    }

    #[test]
    fn fresh_ringing_av_call_is_not_sweepable() {
        let now = 100_000_000;
        let candidate = SweepCandidate {
            session_id: "wrtc:3".into(),
            purpose: PURPOSE_AV_CALL.into(),
            status: SESSION_STATUS_ACTIVE,
            expired: false,
            participants: 2,
            joined: 1,
            last_activity_at: now - 1_000_000,
            ringing_since: now - 1_000_000,
        };
        assert!(!should_sweep_ringing_av_call(&candidate, now));
    }

    #[test]
    fn get_who_terminated_session_prefers_unjoined_participant() {
        let alice = account!("alice");
        let bob = account!("bob");
        assert_eq!(get_who_terminated_session(&[alice, bob], &[]), alice);
        assert_eq!(get_who_terminated_session(&[alice, bob], &[alice]), bob);
    }
}
