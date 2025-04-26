pub mod tables;
mod scoring;

#[psibase::service(tables = "tables::tables")]
pub mod service {
    use crate::tables::tables::{Evaluation, Fractal, InitTable, Member};
    use crate::scoring::calculate_ema;
    use psibase::*;

    #[action]
    fn init() {}

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::new();
        check(
            table.get_index_pk().get(&()).is_some(),
            "service not inited",
        );
    }

    #[action]
    #[allow(non_snake_case)]
    fn create_fractal(name: String, mission: String) {
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

        check_none(Member::get(fractal, sender), "already a member");
        let new_member = Member::new(fractal, sender);
        new_member.save();

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
        let caller = ServiceCaller {
            service: AccountNumber::from("evaluations"),
            sender: get_service(),
        };

        let mut fractal =
            Fractal::get(get_sender()).unwrap_or_else(|| abort_message("fractal does not exist"));

        if fractal.scheduled_evaluation.is_some() {
            caller.call(
                MethodNumber::from(
                    psibase::services::evaluations::action_structs::close::ACTION_NAME,
                ),
                psibase::services::evaluations::action_structs::close {
                    id: fractal.scheduled_evaluation.unwrap(),
                },
            )
        };

        let eval_id: u32 = caller.call(
            MethodNumber::from(psibase::services::evaluations::action_structs::create::ACTION_NAME),
            psibase::services::evaluations::action_structs::create {
                allowed_group_sizes: vec![4, 5, 6],
                use_hooks: true,
                num_options: 6,
                registration,
                deliberation,
                submission,
                finish_by,
            },
        );

        fractal.scheduled_evaluation = Some(eval_id);
        fractal.evaluation_interval = Some(interval_seconds);
        fractal.save();
    }

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
        psibase::check_some(
            Member::get(fractal, account),
            "account is not a member of fractal",
        );

        // check(!member.is_banned)?
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
            
                return (mapped_user.1, user_level_achieved)
            })
            .collect();


        mapped_user_results.iter().for_each(|result| {
            let mut member = check_some(Member::get(fractal, result.0), "failed to get member of fractal");
            let new_ema = calculate_ema(result.1, member.reputation, 0.2).expect("failed calculating new ema");
            member.reputation = new_ema;
            member.save();
        });

        
    }

    #[action]
    #[allow(non_snake_case)]
    fn evalFin(evaluation_id: u32) {
        unimplemented!()
    }

    #[event(history)]
    pub fn created_fractal(fractal_account: AccountNumber) {}

    #[event(history)]
    pub fn joined_fractal(fractal_account: AccountNumber, account: AccountNumber) {}
}

#[cfg(test)]
mod tests;
