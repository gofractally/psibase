#[psibase::service_tables]
pub mod tables {
    use crate::now;
    use async_graphql::SimpleObject;
    use psibase::services::accounts::Wrapper as AccountsSvc;
    use psibase::*;
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack)]
    pub struct InitRow {}

    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "SavedMessageTable", index = 1)]
    #[derive(Debug, Serialize, Deserialize, ToSchema, Fracpack, SimpleObject)]
    pub struct SavedMessage {
        #[primary_key]
        pub msg_id: u64,
        pub receiver: AccountNumber,
        pub sender: AccountNumber,
        pub subject: String,
        pub body: String,
        pub datetime: TimePointSec,
    }
    impl SavedMessage {
        #[secondary_key(1)]
        fn by_receiver(&self) -> AccountNumber {
            self.receiver
        }
    }

    #[table(name = "UserSettingsTable", index = 2)]
    #[derive(Debug, Serialize, Deserialize, ToSchema, Fracpack, SimpleObject)]
    pub struct UserSettings {
        #[primary_key]
        pub user: AccountNumber,
        pub public_key: Vec<u8>,
    }

    impl UserSettings {
        fn new(user: AccountNumber, public_key: Vec<u8>) -> Self {
            Self { user, public_key }
        }

        fn save(&self) {
            UserSettingsTable::new().put(&self).unwrap();
        }

        pub fn add(user: AccountNumber, public_key: Vec<u8>) {
            let user_settings = UserSettings::new(user, public_key);
            user_settings.save();
        }
    }

    #[table(name = "UserGroupsTable", index = 3)]
    #[derive(Debug, Serialize, Deserialize, ToSchema, Fracpack, SimpleObject)]
    pub struct UserGroup {
        pub member: AccountNumber,
        pub group_id: Checksum256,
        pub key: Vec<u8>,
    }

    impl UserGroup {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, Checksum256) {
            (self.member, self.group_id.clone())
        }

        #[secondary_key(1)]
        fn by_group(&self) -> (Checksum256, AccountNumber) {
            (self.group_id.clone(), self.member)
        }

        pub fn add(member: AccountNumber, group_id: Checksum256, key: Vec<u8>) {
            let group = GroupTable::new().get_index_pk().get(&group_id);
            check(group.is_some(), "group does not exist");

            let user_groups = UserGroupsTable::new();
            let user_group = user_groups.get_index_pk().get(&(member, group_id.clone()));
            check(user_group.is_none(), "member already in group");

            user_groups
                .put(&UserGroup {
                    member,
                    group_id,
                    key,
                })
                .unwrap();
        }

        pub fn set_key(&mut self, key: Vec<u8>) {
            check(key.len() > 0, "key must be non-empty");

            self.key = key;
            UserGroupsTable::new().put(&self).unwrap();
        }
    }

    #[table(name = "GroupTable", index = 4)]
    #[derive(Debug, Serialize, Deserialize, ToSchema, Fracpack, SimpleObject)]
    pub struct Group {
        #[primary_key]
        pub id: Checksum256,
        pub name: Option<Vec<u8>>,
        pub description: Option<Vec<u8>>,

        pub key_digest: Checksum256,

        pub created: TimePointSec,
        pub key_rotated: TimePointSec,
        pub expiry: Option<TimePointSec>,
        pub next_msg_id: u32,
    }

    impl Group {
        pub fn add(
            users: Vec<AccountNumber>,
            keys: Vec<Vec<u8>>,
            key_digest: Checksum256,
            expiry: Option<TimePointSec>,
            name: Option<Vec<u8>>,
            description: Option<Vec<u8>>,
        ) -> (bool, Checksum256) {
            for user in users.iter() {
                check(
                    AccountsSvc::call().exists(*user),
                    &format!("account {} doesn't exist", user),
                );
            }

            let now = now();
            if let Some(ref e) = expiry {
                check(now < *e, "invalid expiry");
            }

            let group_table = GroupTable::new();
            let id = crate::get_group_id(users.clone());
            let group = group_table.get_index_pk().get(&id);
            if group.is_some() {
                let mut group = group.unwrap();
                if group.expiry.is_some() {
                    let group_expiry = group.expiry.unwrap();
                    if group_expiry > now {
                        // The group already exists and has not expired, therefore - do nothing.
                        // This gracefully handles races where multiple users try to create
                        // the same group. Only the first caller actually creates the group.
                        return (false, id);
                    } else {
                        // The group already exists but expired, therefore - update the expiry.
                        group.expiry = expiry;
                        group_table.put(&group).unwrap();
                        return (false, id);
                    }
                }

                return (false, id);
            }

            let group = Group {
                id: id.clone(),
                key_digest,
                key_rotated: now,
                created: now,
                expiry,
                name,
                description,
                next_msg_id: 0,
            };
            group_table.put(&group).unwrap();

            for (i, user) in users.into_iter().enumerate() {
                UserGroup::add(user, id.clone(), keys[i].clone());
            }

            (true, id)
        }

        pub fn get(id: Checksum256) -> Option<Self> {
            GroupTable::new().get_index_pk().get(&id)
        }

        pub fn get_assert(id: Checksum256) -> Self {
            let group = Self::get(id);
            check(group.is_some(), "group does not exist");
            group.unwrap()
        }

        pub fn get_members(&self) -> Vec<UserGroup> {
            let user_groups_table = UserGroupsTable::new();
            user_groups_table
                .get_index_by_group()
                .range(
                    (self.id.clone(), AccountNumber::new(0))
                        ..=(self.id.clone(), AccountNumber::new(u64::MAX)),
                )
                .collect::<Vec<_>>()
        }

        pub fn is_member(&self, account: AccountNumber) -> bool {
            self.get_members()
                .iter()
                .any(|group| group.member == account)
        }

        pub fn remove(&self) {
            if self.expiry.is_some() {
                // If a group has a set expiry, it can be deleted by anyone after the expiry
                let expiry = self.expiry.unwrap();
                check(now() > expiry, "group has not expired");
            } else {
                // Otherwise, it can be deleted at any time by a group member.
                check(self.is_member(get_sender()), "sender is not part of group");
            }

            let user_groups_table = UserGroupsTable::new();
            for g in self.get_members() {
                user_groups_table.remove(&g);
            }

            GroupTable::new().remove(&self);
        }

        pub fn rotate_key(&mut self, keys: Vec<Vec<u8>>, key_digest: Checksum256) {
            let members = self.get_members();
            check(
                members.len() == keys.len(),
                "All members need the symmetric key",
            );

            self.key_rotated = now();
            self.key_digest = key_digest;
            GroupTable::new().put(&self).unwrap();

            for (i, mut member) in members.into_iter().enumerate() {
                member.set_key(keys[i].clone());
            }
        }

        pub fn use_msg_id(&mut self) -> u32 {
            let current_msg_id = self.next_msg_id;
            self.next_msg_id += 1;
            GroupTable::new().put(&self).unwrap();
            current_msg_id
        }
    }
}
