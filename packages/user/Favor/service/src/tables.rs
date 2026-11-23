#[psibase::service_tables]
pub mod tables {
    use psibase::{AccountNumber};
    use serde::{Deserialize, Serialize};
    #[table(name = "Lines", index = 0)]
    #[derive(Clone, Debug, Serialize, Deserialize, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText)]
    pub struct Line {
        #[primary_key]
        pub id: u64,
        pub symbol: String,
        pub low: AccountNumber,
        pub high: AccountNumber,
        pub low_limit: u64,
        pub high_limit: u64,
        /// Positive means high owes low. Each side independently grants credit.
        pub balance: i64,
        pub low_fee: u32,
        pub high_fee: u32,
        pub low_forward: bool,
        pub high_forward: bool,
        /// Changes to limits, fees or forwarding invalidate outstanding quotes.
        pub revision: u64,
    }
    impl Line {
        #[secondary_key(1)]
        fn by_pair(&self) -> (String, AccountNumber, AccountNumber) {
            (self.symbol.clone(), self.low, self.high)
        }
        #[secondary_key(2)]
        fn by_low(&self) -> (AccountNumber, String, AccountNumber) {
            (self.low, self.symbol.clone(), self.high)
        }
        #[secondary_key(3)]
        fn by_high(&self) -> (AccountNumber, String, AccountNumber) {
            (self.high, self.symbol.clone(), self.low)
        }
        #[secondary_key(4)]
        fn by_symbol(&self) -> (String, u64) {
            (self.symbol.clone(), self.id)
        }
    }
    #[table(name = "Receipts", index = 1)]
    #[derive(Clone, Debug, Serialize, Deserialize, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText)]
    pub struct Receipt {
        pub owner: AccountNumber,
        pub id: u64,
        pub kind: String,
        pub symbol: String,
        pub incoming: Option<AccountNumber>,
        pub outgoing: Option<AccountNumber>,
        pub received: u64,
        pub sent: u64,
        pub memo: String,
        pub time: i64,
    }
    impl Receipt {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, u64) {
            (self.owner, self.id)
        }
    }
    #[table(name = "Counters", index = 2)]
    #[derive(Serialize, Deserialize, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText)]
    pub struct Counter {
        #[primary_key]
        pub key: u8,
        pub next: u64,
    }
    #[table(name = "Payments", index = 3)]
    #[derive(Serialize, Deserialize, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText)]
    pub struct Payment {
        pub payer: AccountNumber,
        pub nonce: String,
        pub id: u64,
    }
    impl Payment {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, String) {
            (self.payer, self.nonce.clone())
        }
    }
    #[table(name = "RouteKeys", index = 4)]
    #[derive(Serialize, Deserialize, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText)]
    pub struct RouteKey {
        #[primary_key]
        pub key: u8,
        pub epoch: u64,
        pub secret: Vec<u8>,
    }
    #[table(name = "Preferences", index = 5)]
    #[derive(Serialize, Deserialize, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText)]
    pub struct Preference {
        #[primary_key]
        pub user: AccountNumber,
        pub request_only: bool,
    }
    #[table(name = "Requests", index = 6)]
    #[derive(Clone, Serialize, Deserialize, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText)]
    pub struct Request {
        #[primary_key]
        pub hash: String,
        pub owner: AccountNumber,
        pub symbol: String,
        /// Zero permits any positive amount; otherwise payment must match exactly.
        pub amount: u64,
        pub expires_at: i64,
        pub payer: Option<AccountNumber>,
        pub consumed: bool,
        pub revoked: bool,
    }
    impl Request {
        #[secondary_key(1)]
        fn by_owner(&self) -> (AccountNumber, String) {
            (self.owner, self.hash.clone())
        }
    }
}
