mod tables;
mod consts;

#[psibase::service(name = "fractal", tables = "tables::tables")]
pub mod service {
    use crate::tables::tables::{ExampleThing, ExampleThingTable, InitRow, InitTable, Fractal, FractalTable, MemberTable};
    use crate::consts;
    use psibase::*;

    use psibase::services::transact::Wrapper as TransactSvc;

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();

        // Initial service configuration
        let thing_table = ExampleThingTable::new();
        if thing_table.get_index_pk().get(&()).is_none() {
            thing_table
                .put(&ExampleThing {
                    thing: String::from("default thing"),
                })
                .unwrap();
        }
    }

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
    fn setExampleThing(thing: String) {
        let table = ExampleThingTable::new();
        let old_thing = table.get_index_pk().get(&()).unwrap_or_default().thing;

        table
            .put(&ExampleThing {
                thing: thing.clone(),
            })
            .unwrap();

        Wrapper::emit().history().updated(old_thing, thing);
    }

    #[action]
    #[allow(non_snake_case)]
    fn getExampleThing() -> String {
        let table = ExampleThingTable::new();
        table.get_index_pk().get(&()).unwrap_or_default().thing
    }

    #[action]
    fn create_fractal(name: String, mission: String) {
        let table = FractalTable::new();
        let now = TransactSvc::call().currentBlock().time.seconds();
        table
            .put(&Fractal {
                account: get_sender(),
                created_at: psibase::TimePointSec::from(now),
                name,
                mission,
            })
            .unwrap();
    }

    #[action]
    fn set_name(name: String) {
        let table = FractalTable::new();
        table.get_index_pk().get(&get_sender()).unwrap().name = name;
    }

    #[action]
    fn set_mission(mission: String) {
        let table = FractalTable::new();
        table.get_index_pk().get(&get_sender()).unwrap().mission = mission;
    }
    
    #[action]
    fn create_eval() {
        // EvaluationsSrv::call().create_eval(get_sender(), eval_type);
    }
    
    #[action]
    fn finish_eval() {
        // EvaluationsSrc::call().finish_eval(get_sender(), eval_type);
    }

    /// Member interface
    #[action]
    fn join_waitlist(_fractal: AccountNumber) {
        // WaitlistSrv::call().join_waitlist(get_sender());
    }

    #[action]
    fn config_candidacy(_fractal: AccountNumber, enable: bool) {
        let table = MemberTable::new();
        let mut member = table.get_index_pk().get(&get_sender()).unwrap_or_default();
        member.titles |= (enable as u32) << consts::CANDIDATE_TITLE_BIT_OFFSET;
        table.put(&member).unwrap();
    }
    
    /// Eval-Hooks
    #[action]
    fn eval_register(_eval_id: u32, _user: AccountNumber, _desc: String) -> bool {
        // Allow all join requests for now
        return true;
    }
    
    #[action]
    fn eval_group_finish(_eval_id: u32, _group_nr: u32) -> bool {
        // TODO: Update scores for group
        return true;
    }
    

    #[event(history)]
    pub fn updated(old_thing: String, new_thing: String) {}
}

#[cfg(test)]
mod tests;
