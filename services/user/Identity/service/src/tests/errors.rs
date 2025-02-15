use crate::tests::helpers::test_helpers::init_identity_svc;
use psibase::anyhow;

#[psibase::test_case(packages("Identity"))]
// ATTEST: Fails for bad subject names
pub fn test_reject_invalid_accounts(chain: psibase::Chain) -> Result<(), anyhow::Error> {
    let svc = init_identity_svc(&chain);

    chain.new_account("alice".into())?;

    svc.from("alice")
        .attest("willy".into(), 80)
        .match_error("subject account willy doesn't exist")?;

    Ok(())
}

#[psibase::test_case(packages("Identity"))]
// ATTEST: Fails for bad scores (outside of [0..10])
pub fn test_reject_invalid_scores(chain: psibase::Chain) -> Result<(), anyhow::Error> {
    let svc = init_identity_svc(&chain);
    let err = "bad confidence score";

    chain.new_account("alice".into())?;
    chain.new_account("bob".into())?;

    svc.from("alice")
        .attest("bob".into(), 101)
        .match_error(err)?;
    svc.from("alice")
        .attest("bob".into(), 255)
        .match_error(err)?;

    Ok(())
}
