// Target Syntax:
#[psibase::state]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::AccountNumber;
    use psibase::Fracpack;
    use psibase::TimePointSec;
    use psibase::ToSchema;
    use serde::{Deserialize, Serialize};

    #[table(name = "SavedMessageTable", index = 1)]
    #[derive(Debug, Serialize, Deserialize, ToSchema, Fracpack, SimpleObject)]
    pub struct SavedMessage {
        #[primary_key]
        pub msg_id: u64,
        // #[secondary_key]
        pub receiver: AccountNumber,
        pub sender: AccountNumber,
        pub subject: String,
        pub body: String,
        pub datetime: TimePointSec,
    }
}
