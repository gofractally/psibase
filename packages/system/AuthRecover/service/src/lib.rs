#[psibase::service(name = "auth-rcovr")]
#[allow(non_snake_case)]
pub mod service {
    use async_graphql::SimpleObject;
    use psibase::*;
    use serde::{Deserialize, Serialize};
    use services::{
        accounts,
        auth_sig::{self, SubjectPublicKeyInfo},
        transact,
    };
    use std::cell::RefCell;

    const RECOVERY_TIME: Seconds = Seconds::new(15 * 60);

    #[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject)]
    pub struct RecoveryKey {
        key: SubjectPublicKeyInfo,
        expiration: TimePointSec,
    }

    #[table(name = "AuthTable", index = 0)]
    #[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject)]
    pub struct AuthRow {
        #[primary_key]
        pub account: AccountNumber,
        pub pubkey: Option<SubjectPublicKeyInfo>,
        pub key_fingerprint: Checksum256,
        pub recovery: AccountNumber,
        pub rkey: Option<RecoveryKey>,
    }

    impl AuthRow {
        #[secondary_key(1)]
        pub fn by_pubkey(&self) -> (Checksum256, AccountNumber) {
            (self.key_fingerprint.clone(), self.account)
        }
    }

    thread_local! {
        static PENDING: RefCell<Option<(AccountNumber, SubjectPublicKeyInfo)>> = RefCell::new(None);
    }

    #[action]
    fn checkAuthSys(
        _flags: u32,
        sender: AccountNumber,
        action: ServiceMethod,
        claims: Vec<Claim>,
    ) -> bool {
        let has_key = |key: &SubjectPublicKeyInfo| {
            claims
                .iter()
                .any(|claim| claim.service == auth_sig::SERVICE && claim.rawData.0 == key.0)
        };
        let row = AuthTable::read()
            .get_index_pk()
            .get(&sender)
            .expect("sender should have a public key");
        if action.service == get_service() && action.method == method!("activate") {
            return PENDING.with(|pending| {
                let pending = pending.borrow();
                let (_, key) = pending
                    .as_ref()
                    .filter(|(account, _)| *account == sender)
                    .expect(&format!("{sender} should have called setKey"));
                has_key(key)
            });
        }
        PENDING.with(|pending| {
            pending
                .borrow()
                .as_ref()
                .map(|(account, _)| assert!(*account != sender, "{account} must be activated"));
        });
        if action.service == get_service() && action.method == method!("setKey") {
            if let Some(rkey) = &row.rkey {
                let now = transact::Wrapper::call().currentBlock().time.seconds();
                if now <= rkey.expiration && has_key(&rkey.key) {
                    return true;
                }
            }
        }
        row.pubkey.as_ref().map_or(false, |key| has_key(key))
    }

    #[action]
    fn canAuthUserSys(user: AccountNumber) {
        assert!(
            AuthTable::read().get_index_pk().get(&user).is_some(),
            "cannot authorize {user}"
        );
    }

    #[action]
    fn getDlgsSys(_sender: AccountNumber) -> Vec<AccountNumber> {
        Vec::new()
    }

    #[action]
    fn isAuthSys(sender: AccountNumber, authorizers: Vec<AccountNumber>) -> bool {
        authorizers.iter().any(|a| *a == sender)
    }

    #[action]
    fn isRejectSys(sender: AccountNumber, rejecters: Vec<AccountNumber>) -> bool {
        rejecters.iter().any(|a| *a == sender)
    }

    #[action]
    fn setRecovery(recovery: AccountNumber) {
        let sender = get_sender();
        let table = AuthTable::read_write();
        let row = match table.get_index_pk().get(&sender) {
            Some(mut row) => {
                row.recovery = recovery;
                row
            }
            None => AuthRow {
                account: sender,
                pubkey: None,
                key_fingerprint: Default::default(),
                recovery,
                rkey: None,
            },
        };
        table.put(&row).unwrap()
    }

    /// Set's the senders public key
    ///
    /// Must be followed by activate. activate must be called
    /// in the same transaction, and the sender cannot run
    /// any other actions until it is.
    ///
    /// The transaction can be signed by either the regular
    /// signing key or a temporary key set by the recovery
    /// partner.
    #[action]
    fn setKey(key: SubjectPublicKeyInfo) {
        let sender = get_sender();
        PENDING.with(move |pending| {
            let mut pending = pending.borrow_mut();
            assert!(pending.is_none(), "Another key is being set");
            *pending = Some((sender, key));
        });
        accounts::Wrapper::call().incAuthSeq(sender);
        transact::Wrapper::call().setWork(true);
    }

    /// Must be called after setKey in the same transaction.
    /// This verifies that the sender actually has the corresponding
    /// private key.
    ///
    /// - It detects some errors that would leave the account unusable
    /// - It limits the ability of the recovery account to change the
    ///   account key temporarily without being noticed. After changing
    ///   the key, it is impossible to restore the account to its
    ///   original state without access to the original private key.
    ///
    /// TODO: I think runAs needs to clear preauthorized actions
    /// when the account authorization is updated (similar to staged-tx)
    #[action]
    fn activate() {
        let sender = get_sender();
        let me = get_service();
        assert!(
            accounts::Wrapper::call().getAuthOf(sender) == me,
            "{sender} should use {me} as its auth service"
        );
        let (_, key) = PENDING.with(|pending| {
            pending
                .take()
                .filter(|(account, _)| *account == sender)
                .expect(&format!("{sender} should have called setKey first"))
        });
        let table = AuthTable::read_write();
        let mut row = table.get_index_pk().get(&sender).unwrap();
        row.key_fingerprint = sha256(&key.0);
        row.pubkey = Some(key);
        row.rkey = None;
        table.put(&row).unwrap();
        transact::Wrapper::call().setWork(false)
    }

    /// Sets a temporary key that can be used to reset the account key
    ///
    /// recover should be called by the recovery account.
    /// The recovery key can only be used to call setKey.
    #[action]
    fn recover(account: AccountNumber, recovery_key: SubjectPublicKeyInfo) {
        let table = AuthTable::read_write();
        let sender = get_sender();
        let mut row = table
            .get_index_pk()
            .get(&account)
            .filter(|row| row.recovery == get_sender())
            .expect(&format!(
                "{sender} should be the recovery partner of {account}"
            ));
        let expiration = transact::Wrapper::call().currentBlock().time.seconds() + RECOVERY_TIME;
        row.rkey = Some(RecoveryKey {
            key: recovery_key,
            expiration,
        });
        table.put(&row).unwrap()
    }

    /// Creates a new account. The recovery account will be set to the sender.
    #[action]
    fn newAccount(account: AccountNumber, key: SubjectPublicKeyInfo) {
        accounts::Wrapper::call().newAccount(
            account,
            get_service(),
            accounts::NewAccountMode::REQUIRE_NEW,
        );
        let key_fingerprint = sha256(&key.0);
        AuthTable::read_write()
            .put(&AuthRow {
                account,
                pubkey: Some(key),
                key_fingerprint,
                recovery: get_sender(),
                rkey: None,
            })
            .unwrap()
    }
}

#[cfg(test)]
mod tests;
