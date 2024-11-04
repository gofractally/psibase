use crate as psibase;
/// This service manages the active producers.
use crate::{account, AccountNumber};

pub const ROOT: AccountNumber = account!("root");
pub const PRODUCER_ACCOUNT_WEAK: AccountNumber = account!("prods-weak");
pub const PRODUCER_ACCOUNT_STRONG: AccountNumber = account!("prods-strong");

#[crate::service(name = "producers", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    #[action]
    fn setConsensus(prods: crate::Consensus) {
        unimplemented!();
    }

    #[action]
    fn setProducers(prods: Vec<crate::Producer>) {
        unimplemented!();
    }
}
