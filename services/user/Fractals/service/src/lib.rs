pub mod helpers;
mod scoring;
pub mod tables;

#[psibase::service(tables = "tables::tables")]
pub mod service {

    use crate::tables::tables::{EvaluationInstance, Fractal, Member, MemberStatus};

    use psibase::*;

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
        let evaluation = EvaluationInstance::get_assert(fractal, evaluation_type.into());

        evaluation.set_pending_scores(0.0);

        psibase::services::evaluations::Wrapper::call().start(
            get_service(),
            check_some(evaluation.evaluation_id, "no set evaluation id"),
        );
    }

    #[action]
    fn close_eval(fractal: AccountNumber, evaluation_type: u32) {
        let mut evaluation = EvaluationInstance::get_assert(fractal, evaluation_type.into());

        evaluation.save_pending_scores();

        Wrapper::emit()
            .history()
            .evaluation_finished(fractal, evaluation.evaluation_id.unwrap());

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
        evaluation_type: u32,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        interval_seconds: u32,
        force_delete: bool,
    ) {
        let mut evaluation = EvaluationInstance::get_or_create(
            get_sender(),
            evaluation_type.into(),
            interval_seconds,
        );

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
        EvaluationInstance::get_by_evaluation_id(evaluation_id)
            .award_group_scores(group_number, group_result);
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
