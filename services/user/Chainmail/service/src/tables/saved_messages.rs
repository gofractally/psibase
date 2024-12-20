// Target Syntax:
#[psibase::table(name = "SavedMessageTable", index = 1)]
#[derive(Debug, Serialize, Deserialize, ToSchema, Fracpack, SimpleObject)]
struct SavedMessage {
    #[primary_key]
    pub msg_id: u64,
    #[secondary_key]
    pub receiver: AccountNumber,
    pub sender: AccountNumber,
    pub subject: String,
    pub body: String,
    pub datetime: TimePointSec,
}
