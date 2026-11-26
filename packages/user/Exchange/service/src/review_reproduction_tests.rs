//! Actual-chain regressions and remaining review findings.
//! Keep the escrow audit in every case: execution quality and API completeness
//! can fail even when physical quantity accounting remains balanced.
use super::*;

#[psibase::test_case(packages("Exchange"))]
fn review_reproduction_unrelated_stop_changes_sublot_routing(chain: Chain) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let market = Wrapper::push_from(&chain, account!("lp"))
        .create(f.base, f.quote, 10_000, 1_000_000, 100, 100)
        .get()?;
    Wrapper::push_from(&chain, account!("bob"))
        .limit(market, true, 100, 10_000)
        .get()?;
    let armed = chain.fork();
    Wrapper::push_from(&armed, account!("bob"))
        .stop(market, true, 50, 100)
        .get()?;
    let ordinary = Wrapper::push_from(&chain, account!("alice"))
        .trade(market, true, 99, 0, 16)
        .get()?;
    let stop_aware = Wrapper::push_from(&armed, account!("alice"))
        .trade(market, true, 99, 0, 16)
        .get()?;
    assert_eq!((ordinary.0, ordinary.1), (0, 0));
    assert_eq!((stop_aware.0, stop_aware.1), (0, 0));
    let books = |c: &Chain| {
        c.open::<_, PoolTable>()
            .get_index_pk()
            .iter()
            .find(|p| p.market == market && p.bid)
            .unwrap()
            .outgoing
    };
    assert_eq!((books(&chain), books(&armed)), (10_000, 10_000));
    audit(&chain);
    audit(&armed);
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn review_reproduction_unarmed_zero_output_is_refunded(chain: Chain) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let market = Wrapper::push_from(&chain, account!("lp"))
        .create(f.base, f.quote, 2, 2, 1, 1)
        .get()?;
    let before = native_market_balance(&chain, market, f.base);
    let result = Wrapper::push_from(&chain, account!("alice"))
        .trade(market, true, 1, 0, 16)
        .get()?;
    assert_eq!((result.0, result.1), (0, 0));
    assert_eq!(native_market_balance(&chain, market, f.base), before);
    audit(&chain);
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn pagination_native_funded_101st_market_is_accessible(chain: Chain) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let lp = account!("lp");
    let mut last = f.market;
    for _ in 0..100 {
        last = Wrapper::push_from(&chain, lp)
            .create(f.base, f.quote, 2, 2, 1, 1)
            .get()?;
    }
    let native_count = chain.open::<_, MarketTable>().get_index_pk().iter().count();
    assert_eq!(native_count, 101);
    assert_eq!(native_market_balance(&chain, last, f.base), 2);
    let private: Value = serde_json::from_str(&Wrapper::push_from(&chain, lp).snapshot(lp).get()?)?;
    let public: Value =
        serde_json::from_str(&chain.get(crate::SERVICE, "/markets?limit=200")?.text()?)?;
    for snapshot in [&private, &public] {
        let rows = snapshot["markets"].as_array().unwrap();
        assert_eq!(rows.len(), 101);
        assert!(rows.iter().any(|row| row["id"].as_u64() == Some(last)));
    }
    let point: Value = serde_json::from_str(
        &chain
            .get(crate::SERVICE, &format!("/market?market={last}"))?
            .text()?,
    )?;
    assert_eq!(point["market"]["id"], last);
    audit(&chain);
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn review_reproduction_recalled_quote_still_cancels_base_order(chain: Chain) -> Result<(), Error> {
    let f = setup_tokens(&chain, false, false)?;
    Wrapper::push_from(&chain, account!("alice"))
        .limit(f.market, false, 110, 1_000)
        .get()?;
    Wrapper::push_from(&chain, account!("bob"))
        .limit(f.market, true, 90, 9_000)
        .get()?;
    let quote_cash = native_market_balance(&chain, f.market, f.quote);
    let base_cash = native_market_balance(&chain, f.market, f.base);
    Tokens::push_from(&chain, account!("issuer"))
        .recall(
            f.quote,
            crate::SERVICE,
            quote_cash.into(),
            "issuer recall".into(),
            Some(format!("market-{}", f.market)),
        )
        .get()?;
    let deficits = [(f.market, f.quote, quote_cash)];
    audit_with_deficits(&chain, &deficits);
    let (refund, paid) = Wrapper::push_from(&chain, account!("alice"))
        .cancel(f.market, false, 110)
        .get()?;
    assert_eq!((refund, paid), (1_000, 0));
    assert_eq!(
        native_market_balance(&chain, f.market, f.base),
        base_cash - 1_000
    );
    assert_eq!(native_market_balance(&chain, f.market, f.quote), 0);
    let before = state(&chain);
    assert!(Wrapper::push_from(&chain, account!("bob"))
        .cancel(f.market, true, 90)
        .trace
        .error
        .is_some());
    assert_eq!(state(&chain), before, "insolvent quote order stays open");
    audit_with_deficits(&chain, &deficits);
    Ok(())
}
