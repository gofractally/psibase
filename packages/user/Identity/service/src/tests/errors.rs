use crate::tests::helpers::test_helpers::init_identity_svc;
use psibase::{account, anyhow};

#[psibase::test_case(packages("Identity"))]
// ATTEST: Fails for bad subject names
pub fn test_reject_invalid_accounts(chain: psibase::Chain) -> Result<(), anyhow::Error> {
    let svc = init_identity_svc(&chain);

    chain.new_account(account!("alice"))?;

    svc.from("alice")
        .attest(account!("willy"), 80)
        .match_error("subject account willy doesn't exist")?;

    Ok(())
}

#[psibase::test_case(packages("Identity"))]
// ATTEST: Fails for bad scores (outside of [0..10])
pub fn test_reject_invalid_scores(chain: psibase::Chain) -> Result<(), anyhow::Error> {
    let svc = init_identity_svc(&chain);
    let err = "bad confidence score";

    chain.new_account(account!("alice"))?;
    chain.new_account(account!("bob"))?;

    svc.from("alice")
        .attest(account!("bob"), 101)
        .match_error(err)?;
    svc.from("alice")
        .attest(account!("bob"), 255)
        .match_error(err)?;

    Ok(())
}
