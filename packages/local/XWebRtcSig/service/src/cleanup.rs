//! Stale ringing/session sweep and subjective cleanup.

use psibase::services::chat;
use psibase::AccountNumber;

use crate::protocol::ServerFrame;
use crate::signaling::{
    query_session_auth_for_cleanup, EVENT_SESSION_ENDED, EVENT_SESSION_FAILED, PURPOSE_AV_CALL,
};
use crate::state::{
    active_sig_session_ids, cleanup_all_subjective_for_session, joined_accounts_for_session,
    sig_joins_for_session, sig_session_track, touch_sig_session_track, STALE_RINGING_TTL_US,
};

const SESSION_LIFECYCLE_ACTIVE: u8 = 1;

fn session_ids_to_sweep() -> Vec<String> {
    active_sig_session_ids()
}

fn last_activity_for_session(session_id: &str, now: i64) -> i64 {
    if let Some(track) = sig_session_track(session_id) {
        return track.last_activity_at;
    }
    sig_joins_for_session(session_id)
        .into_iter()
        .map(|row| row.joined_at)
        .min()
        .unwrap_or(now)
}

fn ringing_since_for_session(session_id: &str, now: i64) -> i64 {
    if let Some(track) = sig_session_track(session_id) {
        return track.ringing_since;
    }
    last_activity_for_session(session_id, now)
}

fn is_ringing_av_call(auth: &chat::SessionJoinAuth, session_id: &str) -> bool {
    auth.purpose == PURPOSE_AV_CALL
        && auth.lifecycle == SESSION_LIFECYCLE_ACTIVE
        && !auth.expired
        && joined_accounts_for_session(session_id).len() < auth.participants.len()
}

fn terminal_event_account_from_participants(
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

fn terminal_event_account(auth: &chat::SessionJoinAuth, session_id: &str) -> AccountNumber {
    terminal_event_account_from_participants(
        &auth.participants,
        &joined_accounts_for_session(session_id),
    )
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

fn fail_session_subjective(
    session_id: &str,
    auth: &chat::SessionJoinAuth,
    reason: &str,
    _event_kind: u8,
) -> Vec<(i32, ServerFrame)> {
    let account = terminal_event_account(auth, session_id);
    let out = fanout_session_ended(&auth.participants, session_id, account, reason);
    cleanup_all_subjective_for_session(session_id);
    out
}

fn maybe_sweep_session(session_id: &str, now: i64) -> Vec<(i32, ServerFrame)> {
    let auth = query_session_auth_for_cleanup(session_id);
    if auth.purpose.is_empty() {
        cleanup_all_subjective_for_session(session_id);
        return vec![];
    }

    if auth.expired || auth.lifecycle != SESSION_LIFECYCLE_ACTIVE {
        if !joined_accounts_for_session(session_id).is_empty()
            || sig_session_track(session_id).is_some()
        {
            let reason = if auth.expired {
                "expired"
            } else {
                "session-not-active"
            };
            return fail_session_subjective(session_id, &auth, reason, EVENT_SESSION_FAILED);
        }
        cleanup_all_subjective_for_session(session_id);
        return vec![];
    }

    if !is_ringing_av_call(&auth, session_id) {
        return vec![];
    }

    let cutoff = now - STALE_RINGING_TTL_US;
    let stale_at = last_activity_for_session(session_id, now);
    let ringing_since = ringing_since_for_session(session_id, now);
    if stale_at >= cutoff && ringing_since >= cutoff {
        return vec![];
    }

    fail_session_subjective(session_id, &auth, "timeout", EVENT_SESSION_FAILED)
}

pub(crate) fn sweep_stale_sessions_subjective(now: i64) -> Vec<(i32, ServerFrame)> {
    let mut out = Vec::new();
    for session_id in session_ids_to_sweep() {
        out.extend(maybe_sweep_session(&session_id, now));
    }
    out
}

fn sweep_stale_sessions_inner(now: i64) -> Vec<(i32, ServerFrame)> {
    ::psibase::subjective_tx! {
        sweep_stale_sessions_subjective(now)
    }
}

pub fn sweep_stale_sessions(now: i64) -> Vec<(i32, ServerFrame)> {
    sweep_stale_sessions_inner(now)
}

pub fn note_session_activity(session_id: &str, now: i64) {
    touch_sig_session_track(session_id, now);
}

pub fn cleanup_session_if_terminal(
    session_id: &str,
    _auth: &chat::SessionJoinAuth,
    event_kind: u8,
) {
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
        lifecycle: u8,
        expired: bool,
        participants: usize,
        joined: usize,
        last_activity_at: i64,
        ringing_since: i64,
    }

    fn should_sweep_ringing_av_call(candidate: &SweepCandidate, now: i64) -> bool {
        candidate.purpose == PURPOSE_AV_CALL
            && candidate.lifecycle == SESSION_LIFECYCLE_ACTIVE
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
            lifecycle: SESSION_LIFECYCLE_ACTIVE,
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
            lifecycle: SESSION_LIFECYCLE_ACTIVE,
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
            lifecycle: SESSION_LIFECYCLE_ACTIVE,
            expired: false,
            participants: 2,
            joined: 1,
            last_activity_at: now - 1_000_000,
            ringing_since: now - 1_000_000,
        };
        assert!(!should_sweep_ringing_av_call(&candidate, now));
    }

    #[test]
    fn terminal_event_account_prefers_unjoined_participant() {
        let alice = account!("alice");
        let bob = account!("bob");
        assert_eq!(
            terminal_event_account_from_participants(&[alice, bob], &[]),
            alice
        );
        assert_eq!(
            terminal_event_account_from_participants(&[alice, bob], &[alice]),
            bob
        );
    }
}
