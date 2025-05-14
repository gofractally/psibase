mod helpers;
mod scoring;
pub mod tables;

#[psibase::service(tables = "tables::tables")]
pub mod service {

    use crate::helpers::parse_rank_to_accounts;
    use crate::tables::tables::{
        EvalTypeU32, EvaluationInstance, Fractal, Member, MemberStatus, Score,
    };

    use psibase::*;

    use std::collections::HashMap;

    #[action]
    fn create_fractal(fractal_account: AccountNumber, name: String, mission: String) {
        let sender = get_sender();
        psibase::services::auth_delegate::Wrapper::call().newAccount(fractal_account, sender);

        Fractal::add(fractal_account, name, mission);
        Member::add(fractal_account, sender, MemberStatus::Citizen);

        Wrapper::emit().history().created_fractal(fractal_account);
    }

    #[action]
    fn start_eval(fractal: AccountNumber, evaluation_type: u32) {
        let evaluation = EvaluationInstance::get_assert(fractal, evaluation_type);

        let fractal = Fractal::get_assert(evaluation.fractal);
        let fractal_members = fractal.members();

        let registered_evaluation_users = evaluation.users(None).unwrap();

        fractal_members.into_iter().for_each(|member| {
            let is_partcipating = registered_evaluation_users
                .iter()
                .any(|user| user.user == member.account);

            if !is_partcipating {
                Score::get(fractal.account, member.account, evaluation_type).feed_new_score(0.0);
            }
        });

        psibase::services::evaluations::Wrapper::call().start(
            get_service(),
            check_some(evaluation.evaluation_id, "no set evaluation id"),
        );
    }

    #[action]
    fn close_eval(fractal: AccountNumber, evaluation_type: u32) {
        let mut evaluation = EvaluationInstance::get_assert(fractal, evaluation_type);

        let fractal = Fractal::get_assert(fractal);
        let remaining_users = evaluation.users(None).unwrap();

        for user in remaining_users {
            Score::get(fractal.account, user.user, evaluation_type).feed_new_score(0.0);
        }

        Wrapper::emit()
            .history()
            .evaluation_finished(fractal.account, evaluation.evaluation_id.unwrap());

        evaluation.schedule_next_evaluation();
    }

    #[action]
    fn join(fractal: AccountNumber) {
        let sender = get_sender();

        check(sender != fractal, "a fractal cannot join itself");
        check_none(Member::get(fractal, sender), "you are already a member");
        check_none(
            Fractal::get(sender),
            "a fractal cannot join another fractal",
        );

        Member::add(fractal, sender, MemberStatus::Citizen).save();

        Wrapper::emit().history().joined_fractal(sender, fractal);
    }

    #[action]
    fn set_schedule(
        evaluation_type: EvalTypeU32,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        interval_seconds: u32,
        force_delete: bool,
    ) {
        let mut evaluation =
            EvaluationInstance::get_or_create(get_sender(), evaluation_type, interval_seconds);

        evaluation.set_evaluation_schedule(
            registration,
            deliberation,
            submission,
            finish_by,
            interval_seconds,
            force_delete,
        );
    }

    fn check_is_eval() {
        // keep action names less than 12 chars
        // go psibase::service:: get the name

        check(
            get_sender() == AccountNumber::from("evaluations"),
            "sender must be evaluations",
        );
    }

    #[action]
    fn on_eval_register(evaluation_id: u32, account: AccountNumber) {
        check_is_eval();
        let evaluation = EvaluationInstance::get_by_evaluation_id(evaluation_id);
        let member = psibase::check_some(
            Member::get(evaluation.fractal, account),
            "account is not a member of fractal",
        );
        let status = MemberStatus::from(member.member_status);

        check(
            status == MemberStatus::Citizen,
            "must be a citizen to participate",
        );
    }

    #[action]
    fn on_eval_unregister(evaluation_id: u32, account: AccountNumber) {}

    #[action]
    fn on_attestation(
        evaluation_id: u32,
        group_number: u32,
        user: AccountNumber,
        attestation: Vec<u8>,
    ) {
        let acceptable_numbers = EvaluationInstance::get_by_evaluation_id(evaluation_id)
            .users(Some(group_number))
            .unwrap()
            .len();
        let is_valid_attestion = attestation
            .iter()
            .all(|num| *num as usize <= acceptable_numbers);
        check(is_valid_attestion, "invalid attestation");
    }

    #[action]
    fn on_eval_group_fin(evaluation_id: u32, group_number: u32, group_result: Vec<u8>) {
        check_is_eval();

        let evaluation = EvaluationInstance::get_by_evaluation_id(evaluation_id);

        let group_members: Vec<AccountNumber> = evaluation
            .users(Some(group_number))
            .unwrap()
            .into_iter()
            .map(|user| user.user)
            .collect();

        let mut new_member_scores: HashMap<AccountNumber, f32> = group_members
            .clone()
            .into_iter()
            .map(|member| (member, 0.0))
            .collect();

        let group_result = parse_rank_to_accounts(group_result, group_members);

        group_result
            .into_iter()
            .enumerate()
            .for_each(|(index, ranked_member)| {
                let level = (6 as usize) - index;
                let score = level as f32;
                new_member_scores.insert(ranked_member, score);
            });

        for (account, new_score) in new_member_scores.into_iter() {
            Score::get(evaluation.fractal, account, evaluation.eval_type).feed_new_score(new_score);
        }
    }

    #[event(history)]
    pub fn created_fractal(fractal_account: AccountNumber) {}

    #[event(history)]
    pub fn joined_fractal(fractal_account: AccountNumber, account: AccountNumber) {}

    #[event(history)]
    pub fn evaluation_finished(fractal_account: AccountNumber, evaluation_id: u32) {}
}

#[cfg(test)]
mod tests;
