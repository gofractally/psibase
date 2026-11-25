//! Exact-transfer policy shared by the native adapter and deterministic host tests.
//! No app-supplied identity is trusted: the adapter obtains both principals from
//! Host's authenticated call stack and the user from Host Accounts.

#[cfg(not(test))]


pub const APPROVAL_TTL_SECONDS: u64 = 300;
pub const MAX_PENDING: usize = 64;

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(not(test), derive(psio::PsszPack, psio::PsszUnpack))]
pub struct Intent {
    pub user: String,
    pub caller: String,
    pub operation: u8,
    pub token_id: u32,
    pub counterparty: String,
    /// Native atoms, normalized using the token's authoritative precision.
    pub amount: u64,
    pub memo: String,
}

#[derive(Clone, Debug)]
#[cfg_attr(not(test), derive(psio::PsszPack, psio::PsszUnpack))]
pub struct Request {
    pub id: u64,
    pub intent: Intent,
    pub created: u64,
    pub approved: bool,
    pub denied: bool,
    /// Nontransactionally sealed immediately before native broadcast. A failed
    /// or unknown submission does not restore this exact authorization.
    pub sealed: bool,
}

pub fn valid_scope(active_app: &str, user: &str, caller: &str, counterparty: &str) -> bool {
    !user.is_empty() && !caller.is_empty() && caller == active_app && counterparty == caller
}

pub fn valid_publisher(caller: &str) -> bool {
    caller == "transact"
}

pub fn valid_expected_user(current_user: &str, expected_user: &str) -> bool {
    !expected_user.is_empty() && current_user == expected_user
}

pub fn grant_available(id: u64, spent: bool, revoked_through: u64) -> bool {
    id > revoked_through && !spent
}

pub fn advance_revocation_floor(current: u64, expired_ids: impl Iterator<Item = u64>) -> u64 {
    expired_ids.fold(current, u64::max)
}

/// All actual signed Tokens actions must use the wallet whose transfer was
/// reviewed, even when explicit sender hooks introduce other account actions.
pub fn valid_token_senders<'a>(
    expected_user: &str,
    scopes: impl Iterator<Item = (&'a str, &'a str)>,
) -> bool {
    let mut found = false;
    for (sender, service) in scopes {
        if service == "tokens" {
            found = true;
            if sender != expected_user {
                return false;
            }
        }
    }
    found
}

impl Request {
    pub fn unexpired(&self, now: u64) -> bool {
        now >= self.created && now - self.created < APPROVAL_TTL_SECONDS
    }

    pub fn can_consume(&self, intent: &Intent, now: u64, consumed: bool) -> bool {
        self.approved
            && !self.denied
            && !self.sealed
            && !consumed
            && self.unexpired(now)
            && self.intent == *intent
    }

    pub fn can_seal(
        &self,
        active_app: &str,
        current_user: &str,
        senders: &[String],
        now: u64,
        staged: bool,
    ) -> bool {
        staged
            && self.approved
            && !self.denied
            && !self.sealed
            && self.unexpired(now)
            && self.intent.user == current_user
            && valid_scope(
                active_app,
                current_user,
                &self.intent.caller,
                &self.intent.counterparty,
            )
            && !senders.is_empty()
            && senders.iter().all(|sender| sender == current_user)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn intent() -> Intent {
        Intent {
            user: "alice".into(),
            caller: "exchange".into(),
            operation: 0,
            token_id: 1,
            counterparty: "exchange".into(),
            amount: 10,
            memo: "deposit".into(),
        }
    }
    fn approved() -> Request {
        Request {
            id: 1,
            intent: intent(),
            created: 100,
            approved: true,
            denied: false,
            sealed: false,
        }
    }
    #[test]
    fn requires_active_app_and_own_counterparty() {
        assert!(valid_scope("exchange", "alice", "exchange", "exchange"));
        assert!(!valid_scope("evil", "alice", "exchange", "exchange"));
        assert!(!valid_scope("exchange", "alice", "exchange", "evil"));
        assert!(!valid_scope("exchange", "", "exchange", "exchange"));
    }
    #[test]
    fn each_exact_intent_field_is_bound() {
        let request = approved();
        assert!(request.can_consume(&intent(), 101, false));
        let changes: Vec<Box<dyn Fn(&mut Intent)>> = vec![
            Box::new(|i| i.user = "bob".into()),
            Box::new(|i| i.caller = "evil".into()),
            Box::new(|i| i.operation = 1),
            Box::new(|i| i.token_id = 2),
            Box::new(|i| i.counterparty = "evil".into()),
            Box::new(|i| i.amount = 11),
            Box::new(|i| i.memo = "changed".into()),
        ];
        for change in changes {
            let mut altered = intent();
            change(&mut altered);
            assert!(!request.can_consume(&altered, 101, false));
        }
    }
    #[test]
    fn approval_is_one_shot_and_expires() {
        let request = approved();
        assert!(!request.can_consume(&intent(), 101, true));
        assert!(!request.can_consume(&intent(), 99, false));
        assert!(request.can_consume(&intent(), 399, false));
        assert!(!request.can_consume(&intent(), 400, false));
    }
    #[test]
    fn pending_or_denied_cannot_authorize() {
        let mut request = approved();
        request.approved = false;
        assert!(!request.can_consume(&intent(), 101, false));
        request.approved = true;
        request.denied = true;
        assert!(!request.can_consume(&intent(), 101, false));
    }
    #[test]
    fn only_native_transaction_publisher_may_seal() {
        assert!(valid_publisher("transact"));
        for caller in ["exchange", "tokens", "supervisor", "transact-admin", "evil"] {
            assert!(!valid_publisher(caller));
        }
    }
    #[test]
    fn displayed_account_cannot_silently_change_even_with_remembered_trust() {
        assert!(valid_expected_user("alice", "alice"));
        assert!(!valid_expected_user("bob", "alice"));
        assert!(!valid_expected_user("alice", "bob"));
        assert!(!valid_expected_user("alice", ""));
        assert!(!valid_expected_user("", ""));
    }
    #[test]
    fn composition_and_signing_prompts_leave_unsealed_approval_retriable() {
        let request = approved();
        let senders = vec!["alice".into()];
        // Staging prevents a second use in the same composition.
        assert!(!request.can_consume(&intent(), 101, true));
        assert!(request.can_seal("exchange", "alice", &senders, 101, true));
        // A later transfer/signing prompt aborts before the publisher hook;
        // staging rolls back, while the exact user consent remains available.
        assert!(request.can_consume(&intent(), 102, false));
        assert!(!request.can_seal("exchange", "alice", &senders, 102, false));
    }
    #[test]
    fn sealed_approval_never_revives_after_rejected_or_unknown_submission() {
        let mut request = approved();
        let senders = vec!["alice".into()];
        assert!(request.can_seal("exchange", "alice", &senders, 101, true));
        request.sealed = true; // Host nontransactional write immediately before RPC.
        for transactional_tombstone_survived in [false, true] {
            assert!(!request.can_consume(&intent(), 102, transactional_tombstone_survived));
            assert!(!request.can_seal("exchange", "alice", &senders, 102, true));
        }
    }
    #[test]
    fn sealing_requires_exact_user_app_sender_stage_and_live_consent() {
        let mut request = approved();
        let senders = vec!["alice".into(), "alice".into()];
        assert!(request.can_seal("exchange", "alice", &senders, 101, true));
        assert!(!request.can_seal("evil", "alice", &senders, 101, true));
        assert!(!request.can_seal("exchange", "bob", &senders, 101, true));
        assert!(!request.can_seal("exchange", "alice", &["bob".into()], 101, true));
        assert!(!request.can_seal(
            "exchange",
            "alice",
            &["alice".into(), "bob".into()],
            101,
            true
        ));
        assert!(!request.can_seal("exchange", "alice", &senders, 101, false));
        assert!(!request.can_seal("exchange", "alice", &senders, 400, true));
        request.denied = true;
        assert!(!request.can_seal("exchange", "alice", &senders, 101, true));
        assert!(!request.can_consume(&intent(), 101, false));
        request.denied = false;
        request.approved = false;
        assert!(!request.can_seal("exchange", "alice", &senders, 101, true));
    }
    #[test]
    fn actual_token_scopes_reject_mixed_wallets_and_ignore_unrelated_services() {
        assert!(valid_token_senders(
            "alice",
            [("alice", "tokens"), ("vserver", "vserver")].into_iter()
        ));
        assert!(!valid_token_senders(
            "alice",
            [("alice", "tokens"), ("bob", "tokens")].into_iter()
        ));
        assert!(!valid_token_senders(
            "alice",
            [("alice", "exchange"), ("bob", "tokens")].into_iter()
        ));
        assert!(!valid_token_senders(
            "alice",
            [("alice", "staged-tx")].into_iter()
        ));
        assert!(!valid_token_senders("alice", std::iter::empty()));
    }
    #[test]
    fn copied_session_grant_consults_shared_spent_flag_and_revocation_epoch() {
        let request = approved();
        let copied = request.clone();
        assert!(copied.can_consume(&intent(), 101, !grant_available(request.id, false, 0)));
        // The original tab's pre-broadcast persistent flag survives both its
        // RPC failure and the copied tab's absent transactional tombstone.
        assert!(!copied.can_consume(&intent(), 102, !grant_available(request.id, true, 0)));
        assert!(!copied.can_consume(
            &intent(),
            102,
            !grant_available(request.id, false, request.id)
        ));
        assert!(grant_available(request.id + 1, false, request.id));
        assert!(!grant_available(0, false, 0));
    }
    #[test]
    fn garbage_collection_cannot_revive_a_spent_grant_after_clock_rollback() {
        let cutoff = advance_revocation_floor(3, [2, 8, 5].into_iter());
        assert_eq!(cutoff, 8);
        // Per-ID flags may now be deleted, and even a clock rollback that
        // makes an old copied request unexpired cannot restore its nonce.
        for id in [2, 5, 8] {
            assert!(!grant_available(id, false, cutoff));
        }
        assert!(grant_available(9, false, cutoff));
        assert_eq!(advance_revocation_floor(cutoff, [1, 4].into_iter()), cutoff);
    }
}
