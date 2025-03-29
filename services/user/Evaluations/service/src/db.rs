#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{AccountNumber, Fracpack, SingletonKey, Table, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "ConfigTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack)]
    pub struct ConfigRow {
        pub last_used_id: u32,
    }

    impl ConfigRow {
        #[primary_key]
        fn pk(&self) -> SingletonKey {
            SingletonKey {}
        }
    }

    #[table(name = "EvaluationTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Evaluation {
        #[primary_key]
        pub id: u32,
        pub created_at: u32,
        pub owner: AccountNumber,
        pub registration_starts: u32,
        pub deliberation_starts: u32,
        pub submission_starts: u32,
        pub finish_by: u32,
        pub use_hooks: bool,
        pub allowable_group_sizes: Vec<u8>,
    }

    #[table(name = "UserTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct User {
        pub evaluation_id: u32,
        pub user: AccountNumber,
        pub group_number: Option<u32>,
        pub proposal: Option<Vec<u8>>,

        // Change this to a hash and change field name to attestation
        pub submission: Option<Vec<AccountNumber>>,
    }

    impl User {
        #[primary_key]
        fn pk(&self) -> (u32, AccountNumber) {
            (self.evaluation_id, self.user)
        }

        pub fn new(evaluation_id: u32, user: AccountNumber) -> Self {
            Self {
                evaluation_id,
                user,
                group_number: None,
                proposal: None,
                submission: None,
            }
        }

        pub fn get(evaluation_id: u32, user: AccountNumber) -> Self {
            let table = UserTable::new();
            let result = table.get_index_pk().get(&(evaluation_id, user));
            psibase::check(result.is_some(), "user not found");
            result.unwrap()
        }

        pub fn save(&self) {
            let table = UserTable::new();
            table.put(&self).unwrap();
        }
    }

    #[table(name = "GroupTable", index = 3)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct Group {
        pub evaluation_id: u32,
        pub number: u32,
        pub key_submitter: Option<AccountNumber>,
        pub key_hash: Option<String>,
        pub keys: Vec<Vec<u8>>,
        pub result: Option<Vec<AccountNumber>>,
    }

    impl Evaluation {
        pub fn new(
            id: u32,
            created_at: u32,
            owner: AccountNumber,
            registration_starts: u32,
            deliberation_starts: u32,
            submission_starts: u32,
            finish_by: u32,
        ) -> Self {
            Self {
                id,
                owner,
                created_at,
                registration_starts,
                deliberation_starts,
                submission_starts,
                finish_by,
                use_hooks: false,
                allowable_group_sizes: vec![],
            }
        }

        pub fn get_groups(&self) -> Vec<Group> {
            let table = GroupTable::new();
            let result = table
                .get_index_pk()
                .range((self.id, 0)..=(self.id, u32::MAX))
                .collect();
            result
        }

        pub fn get_users(&self) -> Vec<User> {
            let table = UserTable::new();
            let result = table
                .get_index_pk()
                .range((self.id, AccountNumber::new(0))..=(self.id, AccountNumber::new(u64::MAX)))
                .collect();
            result
        }

        pub fn get(evaluation_id: u32) -> Self {
            let table = EvaluationTable::new();
            let result = table.get_index_pk().get(&evaluation_id);
            psibase::check(result.is_some(), "evaluation not found");
            result.unwrap()
        }

        pub fn save(&self) {
            let table = EvaluationTable::new();
            table.put(&self).unwrap();
        }

        pub fn delete(&self) {
            let evaluation_id = self.id;
            let users_table = UserTable::new();

            let users: Vec<User> = users_table
                .get_index_pk()
                .range(
                    (evaluation_id, AccountNumber::new(0))
                        ..=(evaluation_id, AccountNumber::new(u64::MAX)),
                )
                .collect();

            for user in users {
                users_table.erase(&user.pk());
            }

            let groups_table = GroupTable::new();
            let groups: Vec<Group> = groups_table
                .get_index_pk()
                .range((evaluation_id, 0)..=(evaluation_id, u32::MAX))
                .collect();

            for group in groups {
                groups_table.erase(&group.pk());
            }

            let evaluation_table = EvaluationTable::new();
            evaluation_table.erase(&self.id);
        }
    }

    impl Group {
        #[primary_key]
        fn pk(&self) -> (u32, u32) {
            (self.evaluation_id, self.number)
        }

        pub fn get(evaluation_id: u32, number: u32) -> Self {
            let table = GroupTable::new();
            let result = table.get_index_pk().get(&(evaluation_id, number));
            psibase::check(result.is_some(), "group not found");
            result.unwrap()
        }

        pub fn save(&self) {
            let table = GroupTable::new();
            table.put(&self).unwrap();
        }

        pub fn new(evaluation_id: u32, number: u32) -> Self {
            Self {
                evaluation_id,
                number,
                key_submitter: None,
                key_hash: None,
                keys: vec![],
                result: None,
            }
        }
    }
}
