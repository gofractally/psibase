pub mod helpers;

pub mod db;

#[psibase::service(tables = "db::tables")]
#[allow(non_snake_case)]
pub mod service {
    use crate::db::tables::{Evaluation, Group, User, UserSettings};
    use crate::helpers;

    use crate::helpers::EvaluationStatus;

    use psibase::*;

    use psibase::services::evaluations::action_structs as EvalStructs;

    #[event(history)]
    pub fn keysset(evaluation_id: u32, group_number: u32, keys: Vec<Vec<u8>>, hash: String) {}

    #[event(history)]
    pub fn evaluation_created(owner: AccountNumber, evaluation_id: u32) {}

    #[event(history)]
    pub fn evaluation_finished(owner: AccountNumber, evaluation_id: u32) {}

    #[event(history)]
    pub fn group_finished(
        owner: AccountNumber,
        evaluation_id: u32,
        group_number: u32,
        users: Vec<AccountNumber>,
        result: Vec<u8>,
    ) {
    }

    fn declare_group_result(evaluation: Evaluation, group_number: u32, result: Vec<u8>) {
        let group = check_some(
            Group::get(evaluation.owner, evaluation.id, group_number),
            "failed to find group",
        );

        let caller = ServiceCaller {
            service: evaluation.owner,
            sender: get_sender(),
        };

        let users: Vec<AccountNumber> = evaluation
            .get_users()
            .into_iter()
            .map(|user: User| user.owner)
            .collect();

        if evaluation.use_hooks {
            caller.call(
                MethodNumber::from(EvalStructs::evalGroupFin::ACTION_NAME),
                EvalStructs::evalGroupFin {
                    owner: evaluation.owner,
                    evaluation_id: evaluation.id,
                    group_number,
                    users: users.clone(),
                    result: result.clone(),
                },
            )
        }

        Wrapper::emit().history().group_finished(
            evaluation.owner,
            evaluation.id,
            group_number,
            users,
            result,
        );

        group.delete();

        if !evaluation.is_groups() {
            if evaluation.use_hooks {
                let caller = ServiceCaller {
                    service: evaluation.owner,
                    sender: get_sender(),
                };

                caller.call(
                    MethodNumber::from(EvalStructs::evalFin::ACTION_NAME),
                    EvalStructs::evalFin {
                        evaluation_id: evaluation.id,
                    },
                )
            }

            Wrapper::emit().history().evaluation_finished(evaluation.owner, evaluation.id);

            evaluation.delete();
        }
    }

    #[action]
    fn create(
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        allowed_group_sizes: Vec<u8>,
        num_options: u8,
        use_hooks: bool,
    ) {
        check(
            registration < deliberation && deliberation < submission && submission < finish_by,
            "invalid times",
        );

        check(
            allowed_group_sizes.iter().all(|size| *size > 0),
            "allowable group sizes must be greater than 0",
        );

        let new_evaluation = Evaluation::new(
            allowed_group_sizes,
            registration,
            deliberation,
            submission,
            finish_by,
            num_options,
            use_hooks,
        );

        new_evaluation.save();
        Wrapper::emit()
            .history()
            .evaluation_created(get_sender(), new_evaluation.id);
    }

    #[action]
    fn start(evaluation_id: u32) {
        let sender = get_sender();
        let evaluation = Evaluation::get(sender, evaluation_id);

        evaluation.assert_status(helpers::EvaluationStatus::Deliberation);

        check(
            evaluation.get_groups().len() == 0,
            "groups have already been created",
        );

        let mut users_to_process = evaluation.get_users();

        users_to_process.sort_by_key(|user| user.user.value);

        helpers::shuffle_vec(&mut users_to_process, evaluation_id as u64);

        let chunked_groups = check_some(
            helpers::spread_users(&users_to_process, &evaluation),
            "unable to spread users into groups",
        );

        for (index, grouped_users) in chunked_groups.into_iter().enumerate() {
            let group_number: u32 = (index as u32) + 1;
            let new_group = Group::new(sender, evaluation.id, group_number);
            new_group.save();

            for mut user in grouped_users {
                user.group_number = Some(group_number);
                user.save();
            }
        }

        evaluation.save();
    }

    #[action]
    fn setKey(key: Vec<u8>) {
        let user = UserSettings::new(get_sender(), key);
        user.save();
    }

    #[action]
    fn groupKey(owner: AccountNumber, evaluation_id: u32, keys: Vec<Vec<u8>>, hash: String) {
        let evaluation = Evaluation::get(owner, evaluation_id);

        evaluation.assert_status(helpers::EvaluationStatus::Deliberation);

        let sender: AccountNumber = get_sender();

        let user = User::get(sender, evaluation_id, sender);

        let group_number = check_some(user.group_number, "user is not sorted into a group");

        let mut group = Group::get(sender, evaluation_id, group_number).expect("group not found");

        check_none(group.key_submitter, "group key has already been submitted");

        group.key_submitter = Some(sender);
        group.save();

        Wrapper::emit()
            .history()
            .keysset(evaluation_id, group_number, keys, hash);
    }

    #[action]
    fn close_group(owner: AccountNumber, evaluation_id: u32, group_number: u32) {
        let evaluation = Evaluation::get(owner, evaluation_id);
        evaluation.assert_status(EvaluationStatus::Closed);

        declare_group_result(evaluation, group_number, vec![]);
    }

    #[action]
    fn close_groups(owner: AccountNumber, evaluation_id: u32) {
        let evaluation = Evaluation::get(owner, evaluation_id);
        evaluation.assert_status(EvaluationStatus::Closed);

        evaluation.get_groups().iter().for_each(|group| {
            declare_group_result(Evaluation::get(owner, evaluation_id), group.number, vec![]);
        });
    }

    #[action]
    fn propose(owner: AccountNumber, evaluation_id: u32, proposal: Vec<u8>) {
        let sender = get_sender();
        let evaluation = Evaluation::get(owner, evaluation_id);
        evaluation.assert_status(EvaluationStatus::Deliberation);

        let mut user = User::get(owner, evaluation_id, sender);
        let group =
            Group::get(owner, evaluation_id, user.group_number.unwrap()).expect("group not found");

        check(
            group.key_submitter.is_some(),
            "group key has not been submitted",
        );

        user.proposal = Some(proposal);
        user.save();
    }

    #[action]
    fn attest(owner: AccountNumber, evaluation_id: u32, attestation: Vec<u8>) {
        let sender = get_sender();
        let evaluation = Evaluation::get(owner, evaluation_id);

        let ranks_within_scope = attestation
            .iter()
            .all(|rank| rank <= &evaluation.num_options);
        check(ranks_within_scope, "attestation is out of scope");

        evaluation.assert_status(EvaluationStatus::Submission);

        let mut user = User::get(owner, evaluation_id, sender);
        check(user.attestation.is_none(), "you have already submitted");

        user.attestation = Some(attestation);
        user.save();

        let group = check_some(
            Group::get(owner, evaluation_id, user.group_number.unwrap()),
            "failed to find group",
        );

        check(group.key_submitter.is_some(), "cannot attest without key");

        let result = helpers::get_group_result(owner, evaluation_id, user.group_number.unwrap());
        match result {
            helpers::GroupResult::ConsensusSuccess(result) => {
                declare_group_result(evaluation, user.group_number.unwrap(), result.clone());
            }
            helpers::GroupResult::IrreconcilableFailure => {
                declare_group_result(evaluation, user.group_number.unwrap(), vec![]);
            }
            _ => {}
        }
    }

    #[action]
    fn register(owner: AccountNumber, evaluation_id: u32, registrant: AccountNumber) {
        let evaluation = Evaluation::get(owner, evaluation_id);

        evaluation.assert_status(EvaluationStatus::Registration);

        let sender = get_sender();
        check(
            sender == registrant || sender == evaluation.owner,
            "user is not allowed to register",
        );

        let user_settings = UserSettings::get(registrant);

        check(
            user_settings.is_some(),
            "user must have a pre-existing key to be registered",
        );
        let user = User::new(evaluation.owner, evaluation.id, registrant);
        user.save();

        if evaluation.use_hooks {
            let caller = ServiceCaller {
                service: evaluation.owner,
                sender: get_sender(),
            };

            caller.call(
                MethodNumber::from(EvalStructs::evalRegister::ACTION_NAME),
                EvalStructs::evalRegister {
                    account: registrant,
                    evaluation_id: evaluation.id,
                },
            )
        }
    }

    #[action]
    fn unregister(owner: AccountNumber, evaluation_id: u32, registrant: AccountNumber) {
        let evaluation = Evaluation::get(owner, evaluation_id);
        evaluation.assert_status(EvaluationStatus::Registration);

        let sender = get_sender();
        check(
            sender == registrant || sender == evaluation.owner,
            "user is not allowed to unregister",
        );

        let user = User::get(owner, evaluation_id, registrant);
        user.delete();

        if evaluation.use_hooks {
            let caller = ServiceCaller {
                service: evaluation.owner,
                sender: get_sender(),
            };

            caller.call(
                MethodNumber::from(EvalStructs::evalUnregister::ACTION_NAME),
                EvalStructs::evalUnregister {
                    account: registrant,
                    evaluation_id: evaluation.id,
                },
            )
        }
    }
}

#[cfg(test)]
mod tests;
