#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;

    use psibase::{AccountNumber, Fracpack, ToKey, ToSchema};
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
    }

    #[table(name = "UserSettingsTable", index = 4)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct UserSettings {
        #[primary_key]
        pub user: AccountNumber,
        pub key: Vec<u8>,
    }

    impl User {
        #[primary_key]
        pub fn pk(&self) -> (AccountNumber, u32, AccountNumber) {
            (self.owner, self.evaluation_id, self.user)
        }

        #[secondary_key(1)]
        pub fn by_group(&self) -> (AccountNumber, u32, Option<u32>, AccountNumber) {
            (self.owner, self.evaluation_id, self.group_number, self.user)
        }
    }

    impl Evaluation {
        #[primary_key]
        pub fn pk(&self) -> (AccountNumber, u32) {
            (self.owner, self.id)
        }
    }

    impl Group {
        #[primary_key]
        pub fn pk(&self) -> (AccountNumber, u32, u32) {
            (self.owner, self.evaluation_id, self.number)
        }
    }
}

pub mod impls {
    use super::tables::*;
    use crate::helpers::{
        calculate_results, get_current_time_seconds, EvaluationStatus, GroupResult,
    };
    use psibase::services::evaluations::Hooks::hooks_wrapper as EvalHooks;
    use psibase::services::subgroups::Wrapper as Subgroups;
    use psibase::{AccountNumber, Table};
    use rand::{rngs::StdRng, seq::SliceRandom, SeedableRng};

    impl ConfigRow {
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

        pub fn add(owner: AccountNumber, evaluation_id: u32, user: AccountNumber) -> Self {
            let user = Self::new(owner, evaluation_id, user);
            user.save();
            user
        }

        pub fn get(owner: AccountNumber, evaluation_id: u32, user: AccountNumber) -> Option<Self> {
            UserTable::new()
                .get_index_pk()
                .get(&(owner, evaluation_id, user))
        }

        fn save(&self) {
            UserTable::new().put(&self).unwrap();
        }

        pub fn delete(&self) {
            UserTable::new().remove(&self);
        }

        pub fn propose(&mut self, proposal: Vec<u8>) {
            self.proposal = Some(proposal);
            self.save();
        }

        pub fn attest(&mut self, attestation: Vec<u8>, use_hook: bool) {
            psibase::check(
                self.attestation.is_none(),
                format!("user {} has already submitted", self.user).as_str(),
            );

            if use_hook {
                EvalHooks::call_to(self.owner).on_attest(
                    self.evaluation_id,
                    self.group_number.unwrap(),
                    self.user,
                    attestation.clone(),
                );
            }

            self.attestation = Some(attestation);
            self.save();
        }

        pub fn set_group_number(&mut self, group_number: u32) {
            self.group_number = Some(group_number);
            self.save();
        }
    }

    impl Evaluation {
        fn new(
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

        fn get_users(&self) -> Vec<User> {
            let table = UserTable::new();
            table
                .get_index_pk()
                .range(
                    (self.owner, self.id, AccountNumber::new(0))
                        ..=(self.owner, self.id, AccountNumber::new(u64::MAX)),
                )
                .collect()
        }

        fn save(&self) {
            let table = EvaluationTable::new();
            table.put(&self).unwrap();
        }

        fn notify_register(&self, registrant: AccountNumber) {
            if self.use_hooks {
                EvalHooks::call_to(self.owner).on_ev_reg(self.id, registrant);
            }
        }

        fn notify_unregister(&self, registrant: AccountNumber) {
            if self.use_hooks {
                EvalHooks::call_to(self.owner).on_ev_unreg(self.id, registrant);
            }
        }

        // Public interface:

        pub fn add(
            allowable_group_sizes: Vec<u8>,
            registration_starts: u32,
            deliberation_starts: u32,
            submission_starts: u32,
            finish_by: u32,
            num_options: u8,
            use_hooks: bool,
        ) -> Self {
            let eval = Self::new(
                allowable_group_sizes,
                registration_starts,
                deliberation_starts,
                submission_starts,
                finish_by,
                num_options,
                use_hooks,
            );
            eval.save();
            eval
        }

        pub fn get_groups(&self) -> Vec<Group> {
            let table = GroupTable::new();
            table
                .get_index_pk()
                .range((self.owner, self.id, 0)..=(self.owner, self.id, u32::MAX))
                .collect()
        }

        pub fn get_group(&self, group_number: u32) -> Option<Group> {
            let table = GroupTable::new();
            let result = table
                .get_index_pk()
                .get(&(self.owner, self.id, group_number));
            result
        }

        pub fn get(owner: AccountNumber, evaluation_id: u32) -> Self {
            let table = EvaluationTable::new();
            let result = table.get_index_pk().get(&(owner, evaluation_id));
            psibase::check_some(
                result,
                &format!("evaluation {} {} not found", owner, evaluation_id),
            )
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
                users_table.remove(&user);
            }

            let groups_table = GroupTable::new();
            let groups: Vec<Group> = groups_table
                .get_index_pk()
                .range((self.owner, self.id, 0)..=(self.owner, self.id, u32::MAX))
                .collect();

            for group in groups {
                groups_table.remove(&group);
            }

            EvaluationTable::new().remove(&self);
        }

        pub fn get_current_phase(&self) -> EvaluationStatus {
            let current_time_seconds = get_current_time_seconds();
            self.calculate_scheduled_phase(current_time_seconds)
        }

        pub fn assert_status(&self, expected_status: EvaluationStatus) {
            let current_phase = self.get_current_phase();
            if current_phase != expected_status {
                psibase::abort_message(
                    format!(
                    "invalid evaluation phase, expected: {expected_status} actual: {current_phase}"
                )
                    .as_str(),
                );
            }
        }

        pub fn get_user(&self, user: AccountNumber) -> Option<User> {
            User::get(self.owner, self.id, user)
        }

        pub fn register_user(&self, new_user: AccountNumber) {
            psibase::check_none(self.get_user(new_user), "user already registered");

            User::add(self.owner, self.id, new_user);

            self.notify_register(new_user);
        }

        pub fn unregister_user(&self, user: AccountNumber) {
            let user = self.get_user(user).expect("user not found");
            user.delete();

            self.notify_unregister(user.user);
        }

        pub fn create_groups(&self) {
            psibase::check(
                self.get_groups().len() == 0,
                "groups have already been created",
            );

            let mut users = self.get_users();

            // `self.id` is public, so anyone can predict the grouping
            let mut rng = StdRng::seed_from_u64(self.id as u64);
            users.shuffle(&mut rng);

            let allowable_group_sizes = self
                .allowable_group_sizes
                .iter()
                .map(|&size| size as u32)
                .collect();

            let population = users.len() as u32;
            let chunk_sizes = psibase::check_some(
                Subgroups::call().gmp(population, allowable_group_sizes),
                "unable to group users",
            );

            for (index, &chunk_size) in chunk_sizes.iter().enumerate() {
                let group_number = (index as u32) + 1;
                Group::add(self.owner, self.id, group_number);

                for _ in 0..chunk_size {
                    if let Some(mut user) = users.pop() {
                        user.set_group_number(group_number);
                    }
                }
            }
        }
    }

    impl Group {
        pub fn get(owner: AccountNumber, evaluation_id: u32, number: u32) -> Option<Self> {
            let table = GroupTable::new();
            table.get_index_pk().get(&(owner, evaluation_id, number))
        }

        pub fn save(&self) {
            let table = GroupTable::new();
            table.put(&self).unwrap();
        }

        pub fn delete(&self) {
            let users_table = UserTable::new();

            let users: Vec<User> = users_table
                .get_index_pk()
                .range(
                    (self.owner, self.evaluation_id, AccountNumber::new(0))
                        ..=(self.owner, self.evaluation_id, AccountNumber::new(u64::MAX)),
                )
                .collect();

            for user in users {
                users_table.remove(&user);
            }

            GroupTable::new().remove(&self);
        }

        fn new(owner: AccountNumber, evaluation_id: u32, number: u32) -> Self {
            Self {
                owner,
                evaluation_id,
                number,
                key_submitter: None,
            }
        }

        pub fn add(owner: AccountNumber, evaluation_id: u32, number: u32) {
            let group = Group::new(owner, evaluation_id, number);
            psibase::check_none(
                GroupTable::new().get_index_pk().get(&group.pk()),
                "group already exists",
            );

            group.save();
        }

        pub fn get_users(&self) -> Vec<User> {
            let (owner, id, group_num) = self.pk();
            UserTable::new()
                .get_index_by_group()
                .range(
                    (owner, id, Some(group_num), AccountNumber::new(0))
                        ..=(owner, id, Some(group_num), AccountNumber::new(u64::MAX)),
                )
                .collect()
        }

        pub fn get_result(&self) -> Option<Vec<u8>> {
            let users = self.get_users();
            let attestations = users.into_iter().map(|user| user.attestation).collect();
            match calculate_results(attestations) {
                GroupResult::ConsensusSuccess(result) => Some(result),
                _ => None,
            }
        }

        pub fn declare_result(&self, result: Vec<u8>) {
            let parent_eval = Evaluation::get(self.owner, self.evaluation_id);

            if parent_eval.use_hooks {
                EvalHooks::call_to(self.owner).on_grp_fin(
                    self.evaluation_id,
                    self.number,
                    result.clone(),
                );
            }

            let users = self.get_users().into_iter().map(|user| user.user).collect();

            crate::Wrapper::emit().history().group_finished(
                self.owner,
                self.evaluation_id,
                self.number,
                users,
                result,
            );

            self.delete();
        }

        pub fn set_key_submitter(&mut self, submitter: AccountNumber) {
            psibase::check_none(self.key_submitter, "group key has already been submitted");
            self.key_submitter = Some(submitter);
            self.save();
        }
    }
}
