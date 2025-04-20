#[psibase::service_tables]
pub mod tables {
    use crate::helpers::{get_current_time_seconds, EvaluationStatus};
    use async_graphql::SimpleObject;
    use psibase::{AccountNumber, Fracpack, Table, ToKey, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "ConfigTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack)]
    pub struct ConfigRow {
        pub owner: AccountNumber,
        pub last_used_id: u32,
    }

    impl ConfigRow {
        #[primary_key]
        fn pk(&self) -> AccountNumber {
            self.owner
        }

        pub fn next_id(owner: AccountNumber) -> u32 {
            let table = ConfigTable::new();
            let mut config = table.get_index_pk().get(&owner).unwrap_or(Self {
                owner,
                last_used_id: 0,
            });
            config.last_used_id += 1;
            table.put(&config).unwrap();
            config.last_used_id
        }
    }

    #[table(name = "EvaluationTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Evaluation {
        pub id: u32,
        pub created_at: u32,
        pub owner: AccountNumber,
        pub registration_starts: u32,
        pub deliberation_starts: u32,
        pub submission_starts: u32,
        pub finish_by: u32,
        pub use_hooks: bool,
        pub allowable_group_sizes: Vec<u8>,
        pub num_options: u8,
    }

    #[table(name = "UserTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct User {
        pub owner: AccountNumber,
        pub evaluation_id: u32,

        pub user: AccountNumber,
        pub group_number: Option<u32>,
        pub attestation: Option<Vec<u8>>,
        pub proposal: Option<Vec<u8>>,
    }

    #[table(name = "GroupTable", index = 3)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct Group {
        pub owner: AccountNumber,
        pub evaluation_id: u32,
        pub number: u32,
        pub key_submitter: Option<AccountNumber>,
        pub result: Option<Vec<u8>>,
    }

    #[table(name = "UserSettingsTable", index = 4)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct UserSettings {
        #[primary_key]
        pub user: AccountNumber,
        pub key: Vec<u8>,
    }

    impl UserSettings {
        pub fn new(user: AccountNumber, key: Vec<u8>) -> Self {
            Self { user, key }
        }

        pub fn get(user: AccountNumber) -> Option<Self> {
            let table = UserSettingsTable::new();
            table.get_index_pk().get(&user)
        }

        pub fn save(&self) {
            let table = UserSettingsTable::new();
            table.put(&self).unwrap();
        }
    }

    impl User {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, u32, AccountNumber) {
            (self.owner, self.evaluation_id, self.user)
        }

        #[secondary_key(1)]
        fn by_group(&self) -> (AccountNumber, u32, Option<u32>) {
            (self.owner, self.evaluation_id, self.group_number)
        }

        pub fn new(owner: AccountNumber, evaluation_id: u32, user: AccountNumber) -> Self {
            Self {
                owner,
                evaluation_id,
                user,
                group_number: None,
                attestation: None,
                proposal: None,
            }
        }

        pub fn get(owner: AccountNumber, evaluation_id: u32, user: AccountNumber) -> Self {
            let table = UserTable::new();
            let result = table.get_index_pk().get(&(owner, evaluation_id, user));
            psibase::check(result.is_some(), "user not found");
            result.unwrap()
        }

        pub fn save(&self) {
            let table = UserTable::new();
            table.put(&self).unwrap();
        }

        pub fn delete(&self) {
            let table = UserTable::new();
            table.erase(&self.pk());
        }
    }

    impl Evaluation {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, u32) {
            (self.owner, self.id)
        }

        pub fn new(
            allowable_group_sizes: Vec<u8>,
            registration_starts: u32,
            deliberation_starts: u32,
            submission_starts: u32,
            finish_by: u32,
            num_options: u8,
            use_hooks: bool,
        ) -> Self {
            let owner = psibase::get_sender();
            let created_at = get_current_time_seconds();
            let id = ConfigRow::next_id(owner);

            Self {
                id,
                owner,
                created_at,
                registration_starts,
                deliberation_starts,
                submission_starts,
                finish_by,
                use_hooks,
                allowable_group_sizes,
                num_options,
            }
        }

        pub fn get_groups(&self) -> Vec<Group> {
            let table = GroupTable::new();
            let result = table
                .get_index_pk()
                .range((self.owner, self.id, 0)..=(self.owner, self.id, u32::MAX))
                .collect();
            result
        }

        pub fn get_group(&self, group_number: u32) -> Option<Group> {
            let table = GroupTable::new();
            let result = table
                .get_index_pk()
                .get(&(self.owner, self.id, group_number));
            result
        }

        pub fn get_users(&self) -> Vec<User> {
            let table = UserTable::new();
            table
                .get_index_pk()
                .range(
                    (self.owner, self.id, AccountNumber::new(0))
                        ..=(self.owner, self.id, AccountNumber::new(u64::MAX)),
                )
                .collect()
        }

        pub fn get(owner: AccountNumber, evaluation_id: u32) -> Self {
            let table = EvaluationTable::new();
            let result = table.get_index_pk().get(&(owner, evaluation_id));
            psibase::check(result.is_some(), "evaluation not found");
            result.unwrap()
        }

        pub fn save(&self) {
            let table = EvaluationTable::new();
            table.put(&self).unwrap();
        }

        pub fn delete(&self) {
            let users_table = UserTable::new();

            let users: Vec<User> = users_table
                .get_index_pk()
                .range(
                    (self.owner, self.id, AccountNumber::new(0))
                        ..=(self.owner, self.id, AccountNumber::new(u64::MAX)),
                )
                .collect();

            for user in users {
                users_table.erase(&user.pk());
            }

            let groups_table = GroupTable::new();
            let groups: Vec<Group> = groups_table
                .get_index_pk()
                .range((self.owner, self.id, 0)..=(self.owner, self.id, u32::MAX))
                .collect();

            for group in groups {
                groups_table.erase(&group.pk());
            }

            let evaluation_table = EvaluationTable::new();
            evaluation_table.erase(&self.pk());
        }

        pub fn get_current_phase(&self) -> EvaluationStatus {
            let current_time_seconds = get_current_time_seconds();
            self.calculate_scheduled_phase(current_time_seconds)
        }

        fn calculate_scheduled_phase(&self, current_time_seconds: u32) -> EvaluationStatus {
            if current_time_seconds >= self.finish_by {
                EvaluationStatus::Closed
            } else if current_time_seconds >= self.submission_starts {
                EvaluationStatus::Submission
            } else if current_time_seconds >= self.deliberation_starts {
                EvaluationStatus::Deliberation
            } else if current_time_seconds >= self.registration_starts {
                EvaluationStatus::Registration
            } else {
                EvaluationStatus::Pending
            }
        }

        pub fn assert_status(&self, expected_status: EvaluationStatus) {
            let current_phase = self.get_current_phase();
            let phase_name = match current_phase {
                EvaluationStatus::Pending => "Pending",
                EvaluationStatus::Registration => "Registration",
                EvaluationStatus::Deliberation => "Deliberation",
                EvaluationStatus::Submission => "Submission",
                EvaluationStatus::Closed => "Closed",
            };
            psibase::check(
                current_phase == expected_status,
                format!("evaluation must be in {phase_name} phase").as_str(),
            );
        }
    }

    impl Group {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, u32, u32) {
            (self.owner, self.evaluation_id, self.number)
        }

        pub fn get(owner: AccountNumber, evaluation_id: u32, number: u32) -> Option<Self> {
            let table = GroupTable::new();
            table.get_index_pk().get(&(owner, evaluation_id, number))
        }

        pub fn save(&self) {
            let table = GroupTable::new();
            table.put(&self).unwrap();
        }

        pub fn new(owner: AccountNumber, evaluation_id: u32, number: u32) -> Self {
            Self {
                owner,
                evaluation_id,
                number,
                key_submitter: None,
                result: None,
            }
        }
    }
}
