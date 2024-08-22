use crate::tests::helpers::test_helpers::{init_svc, VerifyFailed};
use crate::Wrapper as Identity;

#[psibase::test_case(services("identity"))]
// ATTEST: Fails for bad subject names
pub fn test_reject_invalid_accounts(chain: psibase::Chain) {
    let svc = init_svc::<Identity, Identity>(&chain);

    svc.from("alice")
        .attest("willy".into(), 80)
        .get()
        .fails("subject account willy doesn't exist");
}

#[psibase::test_case(services("identity"))]
// ATTEST: Fails for bad scores (outside of [0..10])
pub fn test_reject_invalid_scores(chain: psibase::Chain) {
    let svc = init_svc::<Identity, Identity>(&chain);
    let err = "bad confidence score";
    svc.from("alice").attest("bob".into(), 101).get().fails(err);
    svc.from("alice").attest("bob".into(), 255).get().fails(err);
}
