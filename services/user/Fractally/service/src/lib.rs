pub mod tables;

#[psibase::service(tables = "tables::tables")]
pub mod service {
    use crate::tables::tables::{Fractal, InitTable, Member, Evaluation};
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

        Wrapper::emit()
            .history()
            .joined_fractal(sender, fractal);
    }

    #[action]
    #[allow(non_snake_case)]
    fn setSchedule(registration: u32, deliberation: u32, submission: u32, finish_by: u32, interval_seconds: u32) {

        let caller = ServiceCaller {
            service: AccountNumber::from("evaluations"),
            sender: get_service(),
        };

        let mut fractal = Fractal::get(get_sender()).unwrap_or_else(|| abort_message("fractal does not exist"));
        
        if fractal.scheduled_evaluation.is_some() {
            caller.call(
                MethodNumber::from(psibase::services::evaluations::action_structs::close::ACTION_NAME),
                psibase::services::evaluations::action_structs::close {
                    id: fractal.scheduled_evaluation.unwrap()
                }
            )
        };


        let eval_id: u32 = caller.call(
            MethodNumber::from(psibase::services::evaluations::action_structs::create::ACTION_NAME),
            psibase::services::evaluations::action_structs::create {
                allowed_group_sizes: vec![4,5,6],
                use_hooks: true,
                num_options: 6,
                registration,
                deliberation,
                submission,
                finish_by
            },
        );

        fractal.scheduled_evaluation = Some(eval_id);
        fractal.evaluation_interval = Some(interval_seconds);
        fractal.save();

    }

    #[event(history)]
    pub fn created_fractal(fractal_account: AccountNumber) {}
    
    #[event(history)]
    pub fn joined_fractal(fractal_account: AccountNumber, account: AccountNumber) {}
    

}

#[cfg(test)]
mod tests;
