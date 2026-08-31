#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{AccountNumber, Fracpack, Table, ToSchema};
    use serde::{Deserialize, Serialize};
    use std::collections::HashSet;

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "UserKeyTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct UserKey {
        #[primary_key]
        pub user: AccountNumber,
        pub key: Vec<u8>,
    }

    impl UserKey {
        pub fn set(user: AccountNumber, key: Vec<u8>) {
            assert!(!key.is_empty(), "key must not be empty");
            Self {
                user,
                key: key.clone(),
            }
            .save();
            crate::Wrapper::emit().history().key_set(user, key);
        }

        fn save(&self) {
            UserKeyTable::new().put(self).unwrap();
        }
    }

    #[table(name = "MeetingTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct Meeting {
        pub id: AccountNumber,
        pub host: AccountNumber,
        pub key_hash: String,
    }

    impl Meeting {
        #[primary_key]
        fn pk(&self) -> AccountNumber {
            self.id
        }

        #[secondary_key(1)]
        fn by_host(&self) -> (AccountNumber, AccountNumber) {
            (self.host, self.id)
        }

        pub fn get(id: AccountNumber) -> Option<Self> {
            MeetingTable::read().get_index_pk().get(&id)
        }

        pub fn get_assert(id: AccountNumber) -> Self {
            Self::get(id).expect("meeting not found")
        }

        pub fn set(
            host: AccountNumber,
            id: AccountNumber,
            accounts: Vec<AccountNumber>,
            wraps: Vec<Vec<u8>>,
            hash: String,
        ) {
            assert!(!hash.is_empty(), "hash must not be empty");
            assert!(
                accounts.len() == wraps.len(),
                "accounts and wraps must be the same length",
            );
            if let Some(existing) = Self::get(id) {
                existing.assert_host(host);
            }

            let members = MeetingMember::set_whitelist(id, host, accounts, wraps);
            Self {
                id,
                host,
                key_hash: hash.clone(),
            }
            .save();
            for (account, wrap) in members {
                MeetingMember::put(id, account, wrap);
            }
            crate::Wrapper::emit().history().meeting_set(id, host, hash);
        }

        pub fn set_member_wrap(
            &self,
            sender: AccountNumber,
            account: AccountNumber,
            wrap: Vec<u8>,
            hash: String,
        ) {
            assert!(!wrap.is_empty(), "wrap must not be empty");
            assert!(self.key_hash == hash, "hash does not match meeting");
            MeetingMember::get_assert(self.id, sender);
            MeetingMember::get_assert(self.id, account).replace_wrap(sender, self.host, wrap);
        }

        pub fn add_members(&self, sender: AccountNumber, accounts: Vec<AccountNumber>) {
            self.assert_host(sender);
            MeetingMember::add_empty(self.id, accounts);
        }

        pub fn delete(self, sender: AccountNumber) {
            self.assert_host(sender);
            MeetingMember::drop_all(self.id);
            let id = self.id;
            let host = self.host;
            self.remove();
            crate::Wrapper::emit().history().meeting_deleted(id, host);
        }

        fn assert_host(&self, sender: AccountNumber) {
            assert!(sender == self.host, "only the host can modify this meeting");
        }

        fn save(&self) {
            MeetingTable::new().put(self).unwrap();
        }

        fn remove(self) {
            MeetingTable::new().remove(&self);
        }
    }

    #[table(name = "MeetingMemberTable", index = 3)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct MeetingMember {
        pub meeting_id: AccountNumber,
        pub account: AccountNumber,
        /// Empty means invited but not yet wrapped.
        pub wrap: Vec<u8>,
    }

    impl MeetingMember {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber) {
            (self.meeting_id, self.account)
        }

        #[secondary_key(1)]
        fn by_account(&self) -> (AccountNumber, AccountNumber) {
            (self.account, self.meeting_id)
        }

        pub fn get(meeting_id: AccountNumber, account: AccountNumber) -> Option<Self> {
            MeetingMemberTable::read()
                .get_index_pk()
                .get(&(meeting_id, account))
        }

        pub fn get_assert(meeting_id: AccountNumber, account: AccountNumber) -> Self {
            Self::get(meeting_id, account).expect("account is not a member")
        }

        fn of_meeting(meeting_id: AccountNumber) -> Vec<Self> {
            MeetingMemberTable::read()
                .get_index_pk()
                .range((meeting_id, AccountNumber::MIN)..=(meeting_id, AccountNumber::MAX))
                .collect()
        }

        fn set_whitelist(
            meeting_id: AccountNumber,
            host: AccountNumber,
            accounts: Vec<AccountNumber>,
            wraps: Vec<Vec<u8>>,
        ) -> Vec<(AccountNumber, Vec<u8>)> {
            let mut seen = HashSet::new();
            let mut members = Vec::new();
            for (account, wrap) in accounts.into_iter().zip(wraps) {
                assert!(seen.insert(account), "duplicate account in whitelist");
                members.push((account, wrap));
            }
            if seen.insert(host) {
                members.push((host, Vec::new()));
            }
            for member in Self::of_meeting(meeting_id) {
                if !seen.contains(&member.account) {
                    member.remove();
                }
            }
            members
        }

        fn add_empty(meeting_id: AccountNumber, accounts: Vec<AccountNumber>) {
            let mut seen = HashSet::new();
            for account in accounts {
                assert!(seen.insert(account), "duplicate account");
                if Self::get(meeting_id, account).is_some() {
                    continue;
                }
                Self::put(meeting_id, account, Vec::new());
            }
        }

        fn replace_wrap(mut self, sender: AccountNumber, host: AccountNumber, wrap: Vec<u8>) {
            if !self.wrap.is_empty() {
                assert!(sender == host, "only the host can replace a wrap");
            }
            self.wrap = wrap;
            self.save();
        }

        fn put(meeting_id: AccountNumber, account: AccountNumber, wrap: Vec<u8>) {
            Self {
                meeting_id,
                account,
                wrap,
            }
            .save();
        }

        fn drop_all(meeting_id: AccountNumber) {
            for member in Self::of_meeting(meeting_id) {
                member.remove();
            }
        }

        fn save(&self) {
            MeetingMemberTable::new().put(self).unwrap();
        }

        fn remove(self) {
            MeetingMemberTable::new().remove(&self);
        }
    }
}

#[psibase::service(name = "meet", tables = "tables")]
pub mod service {
    use crate::tables::{InitRow, InitTable, Meeting, UserKey};
    use psibase::*;

    #[action]
    fn init() {
        InitTable::new().put(&InitRow {}).unwrap();
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        InitTable::read()
            .get_index_pk()
            .get(&())
            .expect("service not inited");
    }

    /// Publish the caller's long-lived meeting public key.
    #[action]
    fn set_key(key: Vec<u8>) {
        UserKey::set(get_sender(), key);
    }

    /// Create or update a private meeting. `id` is an account number chosen by
    /// the host. Fails if a meeting already exists at `id` and the sender is
    /// not its host. `accounts` and `wraps` are parallel; an empty wrap means
    /// that member has no payload yet. The host is always added.
    #[action]
    fn set_meeting(
        id: AccountNumber,
        accounts: Vec<AccountNumber>,
        wraps: Vec<Vec<u8>>,
        hash: String,
    ) {
        Meeting::set(get_sender(), id, accounts, wraps, hash);
    }

    /// Set the wrapped meeting key for a whitelist member.
    ///
    /// If the wrap is unset, any whitelist member may set it (hash must match).
    /// If it is already set, only the host may overwrite it.
    #[action]
    fn set_member_wrap(
        meeting_id: AccountNumber,
        account: AccountNumber,
        wrap: Vec<u8>,
        hash: String,
    ) {
        Meeting::get_assert(meeting_id).set_member_wrap(get_sender(), account, wrap, hash);
    }

    /// Host adds accounts to the whitelist with empty wraps.
    #[action]
    fn add_members(meeting_id: AccountNumber, accounts: Vec<AccountNumber>) {
        Meeting::get_assert(meeting_id).add_members(get_sender(), accounts);
    }

    /// Host deletes a meeting, dropping members and freeing the id.
    #[action]
    fn delete_meeting(meeting_id: AccountNumber) {
        Meeting::get_assert(meeting_id).delete(get_sender());
    }

    #[event(history)]
    pub fn meeting_set(id: AccountNumber, host: AccountNumber, hash: String) {}

    #[event(history)]
    pub fn meeting_deleted(id: AccountNumber, host: AccountNumber) {}

    #[event(history)]
    pub fn key_set(user: AccountNumber, key: Vec<u8>) {}
}

#[cfg(test)]
mod tests;
