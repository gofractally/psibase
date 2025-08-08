use crate as psibase;
/// This service manages the active producers.
use crate::{account, AccountNumber};

pub const ROOT: AccountNumber = account!("root");
pub const PRODUCER_ACCOUNT_WEAK: AccountNumber = account!("prods-weak");
pub const PRODUCER_ACCOUNT_STRONG: AccountNumber = account!("prods-strong");

#[crate::service(name = "producers", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{services::transact::ServiceMethod, AccountNumber, Claim, ConsensusData, Producer};

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

    #[action]
    fn checkAuthSys(
        flags: u32,
        requester: AccountNumber,
        sender: AccountNumber,
        action: ServiceMethod,
        allowedActions: Vec<ServiceMethod>,
        claims: Vec<Claim>,
    ) {
        unimplemented!()
    }

    #[action]
    fn canAuthUserSys(user: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn isAuthSys(
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        auth_set: Option<Vec<AccountNumber>>,
    ) -> bool {
        unimplemented!()
    }

    #[action]
    fn isRejectSys(
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        auth_set: Option<Vec<AccountNumber>>,
    ) -> bool {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
