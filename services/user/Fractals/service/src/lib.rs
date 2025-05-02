mod helpers;
mod scoring;
pub mod tables;

#[psibase::service(tables = "tables::tables")]
pub mod service {

    use crate::helpers::parse_rank_to_accounts;
    use crate::tables::tables::{Fractal, Member, MemberStatus};
    use psibase::*;

    use std::collections::HashMap;

    #[action]
    fn create_fractal(name: String, mission: String) {
        let sender = get_sender();

        check_none(Fractal::get(sender), "fractal already exists");
        Fractal::add(sender, name, mission);

        Wrapper::emit().history().created_fractal(sender);
    }

    #[action]
    fn start_eval(fractal: AccountNumber) {
        let fractal = Fractal::get_assert(fractal);
        let evaluation_id = check_some(fractal.scheduled_evaluation, "no evaluation is scheduled");

        let fractal_members = fractal.members();
        let registered_evaluation_users = fractal.evaluation_users(None);

        fractal_members.into_iter().for_each(|mut member| {
            let is_partcipating = registered_evaluation_users
                .iter()
                .any(|user| user.user == member.account);

            if !is_partcipating {
                member.feed_new_score(0.0);
            }
        });

        psibase::services::evaluations::Wrapper::call().start(get_service(), evaluation_id);
    }

    #[action]
    fn close_eval(fractal: AccountNumber) {
        let mut fractal = Fractal::get_assert(fractal);
        let remaining_users = fractal.evaluation_users(None);

        for user in remaining_users {
            Member::get(fractal.account, user.user).map(|mut member| {
                member.feed_new_score(0.0);
            });
        }

        fractal.schedule_next_evaluation();
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
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        interval_seconds: u32,
        force_delete: bool,
    ) {
        let mut fractal = Fractal::get_assert(get_sender());

        fractal.set_evaluation_schedule(
            registration,
            deliberation,
            submission,
            finish_by,
            interval_seconds,
            force_delete,
        );
    }

    fn check_is_eval() {
        check(
            get_sender() == AccountNumber::from("evaluations"),
            "sender must be evaluations",
        );
    }

    #[action]
    fn on_eval_register(fractal: AccountNumber, evaluation_id: u32, account: AccountNumber) {
        check_is_eval();
        let member = psibase::check_some(
            Member::get(fractal, account),
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
        let fractal = Fractal::get_by_evaluation_id(evaluation_id);
        let acceptable_numbers = fractal.evaluation_users(Some(group_number)).len();
        let is_valid_attestion = attestation
            .iter()
            .all(|num| *num as usize <= acceptable_numbers);
        check(is_valid_attestion, "invalid attestation");
    }

    #[action]
    fn on_eval_group_fin(
        owner: AccountNumber,
        evaluation_id: u32,
        group_number: u32,
        group_result: Vec<u8>,
    ) {
        check_is_eval();
        check(owner == get_service(), "unexpected owner of evaluation");

        let fractal = Fractal::get_by_evaluation_id(evaluation_id);

        let evaluation = check_some(
            fractal.evaluation().map(|eval| eval.num_options),
            "failed getting evaluation",
        );
        let group_members: Vec<AccountNumber> = fractal
            .evaluation_users(Some(group_number))
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
                let level = (evaluation as usize) - index;
                let score = level as f32;
                new_member_scores.insert(ranked_member, score);
            });

        for (account, new_score) in new_member_scores.into_iter() {
            Member::get(fractal.account, account).map(|mut member| {
                member.feed_new_score(new_score);
            });
        }

    }

    #[event(history)]
    pub fn created_fractal(fractal_account: AccountNumber) {}

    #[event(history)]
    pub fn joined_fractal(fractal_account: AccountNumber, account: AccountNumber) {}
}

#[cfg(test)]
mod tests;
