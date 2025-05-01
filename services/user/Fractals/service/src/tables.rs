#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{abort_message, AccountNumber, Fracpack, Table, ToSchema};
    use serde::{Deserialize, Serialize};
    use psibase::services::transact::Wrapper as TransactSvc;


    #[table(name = "FractalTable", index = 0)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Fractal {
        pub account: AccountNumber,
        pub created_at: psibase::TimePointSec,
        pub name: String,
        pub mission: String,
        pub scheduled_evaluation: Option<u32>,
        pub evaluation_interval: Option<u32>
    }

    impl Fractal {
        #[primary_key]
        fn pk(&self) -> AccountNumber {
            self.account
        }


        pub fn new(account: AccountNumber, name: String, mission: String) -> Self {
            let now = TransactSvc::call().currentBlock().time.seconds();

            Self {
                account,
                created_at: now,
                mission,
                name,
                scheduled_evaluation: None,
                evaluation_interval: None,
            }
        }

        pub fn get(fractal: AccountNumber) -> Option<Self> {
            let table = FractalTable::new();
            table.get_index_pk().get(&(fractal))
        }

        pub fn save(&self) {
            let table = FractalTable::new();
            table.put(&self).expect("failed to save");
        }
        
    }

    #[derive(PartialEq)]
    pub enum MemberStatus {
        Visa = 1,
        Citizen = 2,
        Exiled = 3
    }

    pub type StatusU32 = u32;

    impl From<StatusU32> for MemberStatus  {
        fn from(status: StatusU32) -> Self {
            match status {
                1 => MemberStatus::Visa,
                2 => MemberStatus::Citizen,
                3 => MemberStatus::Exiled,
                _ => abort_message("invalid member status")
            }
        }
    }

    #[table(name = "MemberTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Member {
        pub fractal: AccountNumber,
        pub account: AccountNumber,
        pub created_at: psibase::TimePointSec,
        pub reputation: f32,
        pub member_status: StatusU32,
        pub last_evaluation: Option<u32>
    }

    impl Member {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber) {
            (self.fractal, self.account)
        }

    

        pub fn new(fractal: AccountNumber, account: AccountNumber, status: MemberStatus) -> Self {
            Self {
                account,
                fractal,
                created_at: TransactSvc::call().currentBlock().time.seconds(),
                reputation: 0.0,
                member_status: status as StatusU32,
                last_evaluation: None
            }
        }

        pub fn get(fractal: AccountNumber, account: AccountNumber) -> Option<Member> {
            let table = MemberTable::new();
            table.get_index_pk().get(&(fractal, account))
        }

        pub fn save(&self) {
            let table = MemberTable::new();
            table.put(&self).expect("failed to save");
        }
    }

    #[table(name = "EvaluationTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Evaluation {
        pub fractal: AccountNumber,
        pub id: u32,
    }

    impl Evaluation {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, u32) {
            (self.fractal, self.id)
        }

        pub fn new(fractal: AccountNumber, id: u32) -> Self {
            Self {
                fractal,
                id
            }
        }

        pub fn get(fractal: AccountNumber, account: AccountNumber) -> Option<Member> {
            let table = MemberTable::new();
            table.get_index_pk().get(&(fractal, account))
        }

        pub fn save(&self) {
            let table = EvaluationTable::new();
            table.put(&self).expect("failed to save");
        }
    }





}
