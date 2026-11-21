#[psibase::service_tables]
pub mod tables {
    use crate::math::Wide;
    use psibase::{AccountNumber, Pack, ToSchema, Unpack};
    use serde::{Deserialize, Serialize};
    #[table(name = "ConfigTable", index = 0)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct Config {
        pub next: u64,
    }
    impl Config {
        #[primary_key]
        fn pk(&self) {}
    }
    #[table(name = "MarketTable", index = 1)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct Market {
        #[primary_key]
        pub id: u64,
        pub base: u32,
        pub quote: u32,
        pub base_lot: u64,
        pub quote_tick: u64,
        pub x: u64,
        pub y: u64,
        pub k: Wide,
        pub lp_supply: u64,
        pub vault_base: u64,
        pub vault_quote: u64,
        pub debt_base: u64,
        pub debt_quote: u64,
        pub lending_base: u64,
        pub lending_quote: u64,
        pub maturity: u64,
        /// Sticky at creation; None identifies a legacy non-isolated market.
        pub margin_enabled: Option<bool>,
    }
    impl Market {
        #[secondary_key(1)]
        fn by_pair(&self) -> (u32, u32, u64) {
            (self.base, self.quote, self.id)
        }
    }
    #[table(name = "PoolTable", index = 2)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct Pool {
        #[primary_key]
        pub id: u64,
        pub market: u64,
        pub bid: bool,
        pub price: u64,
        pub outgoing: u64,
        pub incoming: u64,
        pub shares: u64,
        pub index: Wide,
        pub dust: Wide,
        pub active: bool,
    }
    #[table(name = "BookTable", index = 3)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct Book {
        pub market: u64,
        pub bid: bool,
        pub priority: u64,
        pub generation: u64,
    }
    impl Book {
        #[primary_key]
        pub fn pk(&self) -> (u64, bool, u64) {
            (self.market, self.bid, self.priority)
        }
    }
    #[table(name = "MakerTable", index = 4)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct Maker {
        pub owner: AccountNumber,
        pub market: u64,
        pub bid: bool,
        pub price: u64,
        pub generation: u64,
        pub shares: u64,
        pub debt: Wide,
    }
    impl Maker {
        #[primary_key]
        pub fn pk(&self) -> (AccountNumber, u64, bool, u64) {
            (self.owner, self.market, self.bid, self.price)
        }
    }
    #[table(name = "LoanTable", index = 5)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct Loan {
        #[primary_key]
        pub generation: u64,
        pub market: u64,
        pub long: bool,
        pub price: u64,
        pub units: u64,
        pub collateral_unit: u64,
        pub face_unit: u64,
        pub active: bool,
        pub original_units: u64,
        pub original_surplus: u64,
        pub surplus: u64,
    }
    #[table(name = "LoanBookTable", index = 6)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct LoanBook {
        pub market: u64,
        pub long: bool,
        pub priority: u64,
        pub generation: u64,
    }
    impl LoanBook {
        #[primary_key]
        pub fn pk(&self) -> (u64, bool, u64) {
            (self.market, self.long, self.priority)
        }
    }
    #[table(name = "BorrowerTable", index = 7)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct Borrower {
        pub owner: AccountNumber,
        pub market: u64,
        pub long: bool,
        pub price: u64,
        pub generation: u64,
        pub units: u64,
    }
    impl Borrower {
        #[primary_key]
        pub fn pk(&self) -> (AccountNumber, u64, bool, u64) {
            (self.owner, self.market, self.long, self.price)
        }
    }
    #[table(name = "LenderTable", index = 8)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct Lender {
        pub owner: AccountNumber,
        pub market: u64,
        pub base: bool,
        pub shares: u64,
    }
    impl Lender {
        #[primary_key]
        pub fn pk(&self) -> (AccountNumber, u64, bool) {
            (self.owner, self.market, self.base)
        }
    }
    #[table(name = "LiquidityTable", index = 9)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct Liquidity {
        pub owner: AccountNumber,
        pub market: u64,
        pub shares: u64,
    }
    impl Liquidity {
        #[primary_key]
        pub fn pk(&self) -> (AccountNumber, u64) {
            (self.owner, self.market)
        }
    }
    #[table(name = "EscrowTable", index = 10)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct Escrow {
        pub market: u64,
        pub token: u32,
        pub balance: u64,
    }
    impl Escrow {
        #[primary_key]
        pub fn pk(&self) -> (u64, u32) {
            (self.market, self.token)
        }
    }
}
