#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{AccountNumber, Pack, TimePointSec, ToSchema, Unpack};
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Pack, Unpack)]
    pub struct InitRow {}

    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "SavedMessageTable", index = 1)]
    #[derive(Debug, Serialize, Deserialize, ToSchema, Pack, Unpack, SimpleObject)]
    pub struct SavedMessage {
        #[primary_key]
        pub msg_id: u64,
        pub receiver: AccountNumber,
        pub sender: AccountNumber,
        pub subject: String,
        pub body: String,
        pub datetime: TimePointSec,
    }
    impl SavedMessage {
        #[secondary_key(1)]
        fn by_receiver(&self) -> AccountNumber {
            self.receiver
        }
    }
}
