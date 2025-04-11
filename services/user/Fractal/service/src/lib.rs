mod tables;
mod consts;

#[psibase::service(name = "fractal", tables = "tables::tables")]
pub mod service {
    use crate::tables::tables::{InitRow, InitTable, Fractal, FractalTable, Member, MemberTable};
    use crate::consts;
    use psibase::*;

    use psibase::services::transact::Wrapper as TransactSvc;

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();

        // Initial service configuration
        
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
    fn join_waitlist(fractal: AccountNumber) {
        // for now, allow all immediate membership
        let table = MemberTable::new();
        table.put(&Member {
            fractal,
            account: get_sender(),
            joined_at: psibase::TimePointSec::from(TransactSvc::call().currentBlock().time.seconds()),
            titles: 0,
        }).unwrap();

        // Eventually...
        // let table = WaitlistTable::new();
        // table.put(&Waitlist {
        //     fractal: _fractal,
        //     account: get_sender(),
        //     joined_at: psibase::TimePointSec::from(TransactSvc::call().currentBlock().time.seconds()),
        // }).unwrap();
    }

    #[action]
    fn config_candidacy(fractal: AccountNumber, enable: bool) {
        let table = MemberTable::new();
        let mut member = table.get_index_pk().get(&(fractal, get_sender())).unwrap_or_default();
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
