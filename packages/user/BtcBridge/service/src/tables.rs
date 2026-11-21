use btcbridge_core as btc;
use psibase::{AccountNumber, Pack, ToSchema, Unpack};
use serde::{Deserialize, Serialize};
#[psibase::service_tables]
pub mod tables {
    use super::*;
    #[table(name = "ConfigTable", index = 0)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct Config {
        pub policy: String,
        pub token: u32,
        pub treasury: AccountNumber,
        pub next_address: u32,
        pub next_request: u64,
        pub next_batch: u32,
        pub reserve: u64,
        pub liability: u64,
        pub escrow: u64,
        pub paused: bool,
        pub reason: String,
    }
    impl Config {
        #[primary_key]
        fn pk(&self) {}
    }
    #[table(name = "AddressTable", index = 1)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct DepositAddress {
        #[primary_key]
        pub index: u32,
        pub owner: AccountNumber,
        pub address: String,
        pub script: String,
    }
    impl DepositAddress {
        #[secondary_key(1)]
        fn by_owner(&self) -> (AccountNumber, u32) {
            (self.owner, self.index)
        }
    }
    #[table(name = "ScriptTable", index = 2)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct CustodyScript {
        #[primary_key]
        pub script: String,
        pub branch: u32,
        pub index: u32,
        pub owner: AccountNumber,
    }
    #[table(name = "UtxoTable", index = 3)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct Utxo {
        #[primary_key]
        pub id: String,
        pub txid: String,
        pub vout: u32,
        pub value: u64,
        pub branch: u32,
        pub index: u32,
        pub height: u32,
        pub block: String,
        pub status: u8,
        pub batch: u32,
    }
    impl Utxo {
        #[secondary_key(1)]
        fn by_status(&self) -> (u8, u32, String) {
            (self.status, self.height, self.id.clone())
        }
        pub fn input(&self) -> btc::Input {
            btc::Input {
                txid: self.txid.clone(),
                vout: self.vout,
                value: self.value,
                branch: self.branch,
                index: self.index,
                height: self.height,
            }
        }
    }
    #[table(name = "RequestTable", index = 4)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct Withdrawal {
        #[primary_key]
        pub id: u64,
        pub owner: AccountNumber,
        pub address: String,
        pub script: String,
        pub amount: u64,
        pub max_fee: u64,
        pub service_fee: u64,
        pub created: u64,
        pub status: u8,
        pub batch: u32,
        pub paid_fee: u64,
        pub txid: String,
    }
    impl Withdrawal {
        #[secondary_key(1)]
        fn by_status(&self) -> (u8, u64) {
            (self.status, self.id)
        }
        #[secondary_key(2)]
        fn by_owner(&self) -> (AccountNumber, u64) {
            (self.owner, self.id)
        }
        pub fn payment(&self) -> btc::Payment {
            btc::Payment {
                id: self.id,
                script: self.script.clone(),
                amount: self.amount,
                max_fee: self.max_fee,
            }
        }
    }
    #[table(name = "BatchTable", index = 5)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct Batch {
        #[primary_key]
        pub id: u32,
        pub status: u8,
        pub created: u64,
        pub current_revision: u32,
        pub requests: Vec<u64>,
        pub txid: String,
    }
    impl Batch {
        #[secondary_key(1)]
        fn by_status(&self) -> (u8, u32) {
            (self.status, self.id)
        }
    }
    #[table(name = "RevisionTable", index = 6)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct Revision {
        pub batch: u32,
        pub revision: u32,
        pub plan: String,
        pub policy: String,
        pub authorized_block: u32,
        pub created: u64,
        pub raw: String,
    }
    impl Revision {
        #[primary_key]
        fn pk(&self) -> (u32, u32) {
            (self.batch, self.revision)
        }
    }
    #[table(name = "SignatureTable", index = 7)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct SignerResponse {
        pub batch: u32,
        pub revision: u32,
        pub signer: u8,
        pub signatures: Vec<String>,
    }
    impl SignerResponse {
        #[primary_key]
        fn pk(&self) -> (u32, u32, u8) {
            (self.batch, self.revision, self.signer)
        }
    }
    #[table(name = "TxTable", index = 8)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct TxRecord {
        #[primary_key]
        pub txid: String,
        pub batch: u32,
        pub revision: u32,
    }
    #[table(name = "SigningLinkTable", index = 9)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct SigningLink {
        pub batch: u32,
        pub revision: u32,
        pub signer: u8,
        pub input: u32,
        pub request: u64,
    }
    impl SigningLink {
        #[primary_key]
        fn pk(&self) -> (u32, u32, u8, u32) {
            (self.batch, self.revision, self.signer, self.input)
        }
    }
    #[table(name = "CustodyKeyTable", index = 10)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct CustodyKey {
        #[primary_key]
        pub signer: u8,
        pub key: u32,
        pub provider: AccountNumber,
    }
    #[derive(Clone, Debug, Default, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct FeeTerms {
        pub fee_bps: u16,
        pub publisher_bps: u16,
    }
    #[table(name = "DepositFeesTable", index = 11)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct DepositFees {
        pub current: FeeTerms,
        pub pending: Option<FeeTerms>,
        pub activates_at: u64,
    }
    impl DepositFees {
        #[primary_key]
        fn pk(&self) {}
    }
    #[table(name = "DepositTable", index = 12)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct Deposit {
        #[primary_key]
        pub id: String,
        pub txid: String,
        pub vout: u32,
        pub owner: AccountNumber,
        pub address_index: u32,
        pub value: u64,
        pub credited: u64,
        pub fee: u64,
        pub bounty: u64,
        pub publisher: Option<AccountNumber>,
        pub fee_bps: u16,
        pub publisher_bps: u16,
        pub height: u32,
        pub block: String,
        pub credited_at: u64,
        pub legacy: bool,
    }
    impl Deposit {
        #[secondary_key(1)]
        fn by_height(&self) -> (u32, String) {
            (self.height, self.id.clone())
        }
        #[secondary_key(2)]
        fn by_owner(&self) -> (AccountNumber, u32, String) {
            (self.owner, self.height, self.id.clone())
        }
    }
}
