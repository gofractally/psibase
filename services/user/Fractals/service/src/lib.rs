mod scoring;
pub mod tables;

#[psibase::service(tables = "tables::tables")]
pub mod service {
    use crate::scoring::calculate_ema;
    use crate::tables::tables::{Fractal, Member, MemberStatus};
    use psibase::{AccountNumber, *};

    #[action]
    #[allow(non_snake_case)]
    fn createFractal(name: String, mission: String) {
        let sender = get_sender();

        check_none(Fractal::get(sender), "fractal already exists");
        let new_fractal = Fractal::new(sender, name, mission);
        new_fractal.save();

        Wrapper::emit().history().created_fractal(sender);
    }

    #[action]
    #[allow(non_snake_case)]
    fn join(fractal: AccountNumber) {
        let sender = get_sender();

        check(sender != fractal, "a fractal cannot join itself");
        check_none(Member::get(fractal, sender), "you are already a member");
        check_none(
            Fractal::get(sender),
            "a fractal cannot join another fractal",
        );

        Member::new(fractal, sender, MemberStatus::Citizen).save();

        Wrapper::emit().history().joined_fractal(sender, fractal);
    }

    #[action]
    #[allow(non_snake_case)]
    fn setSchedule(
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        interval_seconds: u32,
    ) {
        let mut fractal = check_some(Fractal::get(get_sender()), "failed to find fractal");

        if fractal.scheduled_evaluation.is_some() {
            psibase::services::evaluations::Wrapper::call()
                .delete(fractal.scheduled_evaluation.unwrap(), false);
        };

        let eval_id: u32 = psibase::services::evaluations::Wrapper::call().create(
            registration,
            deliberation,
            submission,
            finish_by,
            vec![4, 5, 6],
            6,
            true,
        );

        fractal.scheduled_evaluation = Some(eval_id);
        fractal.evaluation_interval = Some(interval_seconds);
        fractal.save();
    }

    fn closeEval() {}

    fn check_is_eval() {
        check(
            get_sender() == AccountNumber::from("evaluations"),
            "sender must be evaluations",
        );
    }

    #[action]
    #[allow(non_snake_case)]
    fn evalRegister(fractal: AccountNumber, evaluation_id: u32, account: AccountNumber) {
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
    #[allow(non_snake_case)]
    fn evalUnregister(evaluation_id: u32, account: AccountNumber) {}

    #[action]
    #[allow(non_snake_case)]
    fn evalGroupFin(
        owner: AccountNumber,
        evaluation_id: u32,
        group_number: u32,
        users: Vec<AccountNumber>,
        result: Vec<u8>,
    ) {
        check_is_eval();

        let fractal = owner;
        let acceptable_numbers = users.len();
        let is_valid_numbers = result.iter().all(|num| *num as usize <= acceptable_numbers);
        if !is_valid_numbers {
            // Ut oh
            return;
        }

        let user_levels: Vec<(u8, usize)> = result
            .iter()
            .enumerate()
            .map(|(index, user)| {
                let level = 6 - index;
                let user_position = *user;
                (user_position, level)
            })
            .collect();

        let mut the_users = users;
        the_users.sort_by(|a, b| a.value.cmp(&b.value));

        let mapped_users: Vec<(usize, AccountNumber)> = the_users
            .into_iter()
            .enumerate()
            .map(|(index, user)| (index + 1, user))
            .collect();

        let mapped_user_results: Vec<(AccountNumber, u8)> = mapped_users
            .into_iter()
            .map(|mapped_user| {
                let user_level_achieved = user_levels
                    .iter()
                    .find_map(|user_level| {
                        if user_level.0 as u32 == mapped_user.0 as u32 {
                            return Some(user_level.1 as u8);
                        } else {
                            return None;
                        }
                    })
                    .unwrap_or(0);

                return (mapped_user.1, user_level_achieved);
            })
            .collect();

        mapped_user_results.iter().for_each(|result| {
            let mut member = check_some(
                Member::get(fractal, result.0),
                "failed to get member of fractal",
            );

            member.reputation = calculate_ema(result.1, member.reputation, 0.2)
                .expect("failed calculating new ema");
            member.save();
        });
    }

    #[event(history)]
    pub fn created_fractal(fractal_account: AccountNumber) {}

    #[event(history)]
    pub fn joined_fractal(fractal_account: AccountNumber, account: AccountNumber) {}
}

#[cfg(test)]
mod tests;
