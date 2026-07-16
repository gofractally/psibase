use crate::Wrapper;
use psibase::{
    account,
    services::{http_server, tokens},
    tester::PRODUCER_ACCOUNT,
    AccountNumber, ChainEmptyResult,
};

use super::query::get_user_resources;

pub(super) fn assert_error(result: ChainEmptyResult, message: &str) {
    let err = result.trace.error.unwrap();
    let contains_error = err.contains(message);
    assert!(
        contains_error,
        "Error \"{}\" does not contain: \"{}\"",
        err, message
    );
}

pub(super) fn check_balance(
    chain: &psibase::Chain,
    token_id: tokens::TID,
    account: AccountNumber,
    expected_value: u64,
) {
    let balance = tokens::Wrapper::push(chain)
        .getBalance(token_id, account)
        .get()
        .unwrap();
    assert!(balance.value == expected_value);
}

pub(super) fn enable_billing(chain: &psibase::Chain) -> Result<(), psibase::Error> {
    Wrapper::push(&chain).init().get()?;

    let sys: tokens::TID = 1;
    let alice = account!("alice");
    let vserver = Wrapper::SERVICE;
    let tokens = tokens::Wrapper::SERVICE;
    let auth_prod = chain.login(PRODUCER_ACCOUNT, Wrapper::SERVICE)?;

    // This is still needed even though the package config specifies the server...
    http_server::Wrapper::push_from(&chain, vserver)
        .registerServer(vserver)
        .get()?;
    chain.finish_block();

    chain
        .propose::<Wrapper>(PRODUCER_ACCOUNT, Wrapper::SERVICE)
        .init_billing(tokens)
        .get()?;

    let min_resource_buffer = get_user_resources(&chain, PRODUCER_ACCOUNT, &auth_prod)?
        .bufferCapacity
        .quantity
        .value;

    tokens::Wrapper::push_from(&chain, alice)
        .credit(sys, PRODUCER_ACCOUNT, min_resource_buffer.into(), "".into())
        .get()?;

    tokens::Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
        .credit(sys, vserver, min_resource_buffer.into(), "".into())
        .get()?;
    Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
        .buy_res(min_resource_buffer.into())
        .get()?;

    // Give producer account some more tokens for general use
    tokens::Wrapper::push_from(&chain, alice)
        .credit(sys, PRODUCER_ACCOUNT, 50_000_0000.into(), "".into())
        .get()?;

    chain
        .propose::<Wrapper>(PRODUCER_ACCOUNT, Wrapper::SERVICE)
        .enable_billing()
        .get()?;

    Ok(())
}
