use crate as psibase;
/// This service manages the active producers.
use crate::{account, AccountNumber};

pub const ROOT: AccountNumber = account!("root");
pub const PRODUCER_ACCOUNT_WEAK: AccountNumber = account!("prods-weak");
pub const PRODUCER_ACCOUNT_STRONG: AccountNumber = account!("prods-strong");

#[crate::service(name = "producer-sys", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {

    #[action]
    fn setProducers(prods: Vec<crate::ProducerConfigRow>) {
        unimplemented!();
    }
}
