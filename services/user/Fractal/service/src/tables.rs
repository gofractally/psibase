#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{AccountNumber, Fracpack, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "FractalTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Fractal {
        pub account: AccountNumber,
        pub created_at: psibase::TimePointSec,
        pub name: String,
        pub mission: String,
    }

    impl Fractal {
        #[primary_key]
        fn pk(&self) -> AccountNumber {
            self.account
        }
    }

    #[table(name = "MemberTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Member {
        pub fractal: AccountNumber,
        pub account: AccountNumber,
        pub joined_at: psibase::TimePointSec,
        pub titles: u32,
    }

    impl Member {
        #[primary_key]
        fn pk(&self) -> AccountNumber {
            self.account
        }
    }

    #[table(name = "ScoreTable", index = 3)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Score {
        pub fractal: AccountNumber,
        pub account: AccountNumber,
        pub value: u32,
    }

    impl Score {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber) {
            (self.fractal, self.account)
        }
    }

    // TODO: Add waitlist table later
    // #[table(name = "WaitlistTable", index = 4)]
    // #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    // pub struct Waitlist {
    //     pub fractal: AccountNumber,
    //     pub account: AccountNumber,
    //     pub joined_at: psibase::TimePointSec,
    // }
    // impl Waitlist {
    //     #[primary_key]
    //     fn pk(&self) -> (AccountNumber, AccountNumber) {
    //         (self.fractal, self.account)
    //     }
    // }
}
