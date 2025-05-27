use crate as psibase;
/// This service manages the active producers.
use crate::{account, AccountNumber};

pub const ROOT: AccountNumber = account!("root");
pub const PRODUCER_ACCOUNT_WEAK: AccountNumber = account!("prods-weak");
pub const PRODUCER_ACCOUNT_STRONG: AccountNumber = account!("prods-strong");

#[crate::service(name = "producers", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{AccountNumber, ConsensusData, Producer};

    #[action]
    fn setConsensus(prods: ConsensusData) {
        unimplemented!();
    }

    #[action]
    fn setProducers(prods: Vec<Producer>) {
        unimplemented!();
    }

    #[action]
    fn getProducers() -> Vec<AccountNumber> {
        unimplemented!();
    }

    #[action]
    fn getThreshold(account: AccountNumber) -> u32 {
        unimplemented!();
    }

    #[action]
    fn antiThreshold(account: AccountNumber) -> u32 {
        unimplemented!();
    }
}
