//! Native recording, rollback, sparse long intervals and bounded objective state.
use super::*;

fn candles(chain: &Chain) -> Vec<CurrentCandle> {
    chain
        .open::<_, CurrentCandleTable>()
        .get_index_pk()
        .iter()
        .collect()
}
#[psibase::test_case(packages("Exchange"))]
fn native_candles_hour_day_events_and_five_current_rows_survive_many_days(
    chain: Chain,
) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let trader = Wrapper::push_from(&chain, account!("trader"));
    trader.trade(f.market, true, 2000, 0, 64).get()?;
    assert_eq!(candles(&chain).len(), 5);
    let before = serde_json::to_value(candles(&chain))?;
    assert!(trader
        .trade(f.market, true, 2000, u64::MAX, 64)
        .trace
        .error
        .is_some());
    assert_eq!(
        serde_json::to_value(candles(&chain))?,
        before,
        "rejected trade changed objective candle state"
    );
    // The first action rolls every candle and emits completed history. A later
    // action rejects the same transaction, exercising rollback *after* both
    // objective candle writes and event emission, rather than just early checks.
    chain.start_block_after(MicroSeconds::from_ticks(86_400_000_000));
    let mut tx = Transaction {
        tapos: Default::default(),
        actions: vec![
            Wrapper::pack_from(account!("trader")).trade(f.market, true, 2000, 0, 64),
            Wrapper::pack_from(account!("trader")).trade(f.market, true, 0, 0, 64),
        ],
        claims: vec![],
    };
    chain.fill_tapos(&mut tx, 2);
    let trace = chain.push(&SignedTransaction {
        transaction: psio::pssz::Nested::new(&tx).unwrap(),
        proofs: vec![],
        subjectiveData: None,
    });
    assert!(trace.error.is_some());
    assert_eq!(
        serde_json::to_value(candles(&chain))?,
        before,
        "later failure retained candle rollover state"
    );
    for day in 1..=6 {
        chain.start_block_after(MicroSeconds::from_ticks(86_400_000_000));
        trader.trade(f.market, day % 2 == 0, 2000, 0, 64).get()?;
        assert_eq!(
            candles(&chain).len(),
            5,
            "historical candles leaked into objective state"
        );
    }
    for _ in 0..4 {
        chain.start_block();
    }
    for interval in [3600, 86400] {
        let response = chain.get(
            crate::SERVICE,
            &format!("/candles?market={}&interval={interval}&limit=20", f.market),
        )?;
        assert_eq!(
            response.status,
            200,
            "{}",
            String::from_utf8_lossy(&response.body)
        );
        let page: Value = serde_json::from_slice(&response.body)?;
        let rows = page["candles"].as_array().unwrap();
        assert_eq!(
            rows.len(),
            7,
            "must emit only actual execution buckets, not empty time bars"
        );
        assert_eq!(rows.iter().filter(|c| c["complete"] == true).count(), 6);
        assert!(rows
            .windows(2)
            .all(|w| w[0]["time"].as_u64() > w[1]["time"].as_u64()));
        assert!(rows
            .iter()
            .filter(|c| c["complete"] == true)
            .all(|c| c["event_id"].is_string()));
        let first: Value = serde_json::from_slice(
            &chain
                .get(
                    crate::SERVICE,
                    &format!("/candles?market={}&interval={interval}&limit=2", f.market),
                )?
                .body
                ,
        )?;
        let cursor = first["next_before"].as_str().unwrap();
        let second: Value = serde_json::from_slice(
            &chain
                .get(
                    crate::SERVICE,
                    &format!(
                        "/candles?market={}&interval={interval}&limit=2&before={cursor}",
                        f.market
                    ),
                )?
                .body
                ,
        )?;
        assert!(second["candles"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["complete"] == true));
        assert!(second["candles"][0]["time"].as_u64() < first["candles"][1]["time"].as_u64());
    }
    audit(&chain);
    Ok(())
}
#[psibase::test_case(packages("Exchange"))]
fn native_candles_count_seed_stop_and_liquidation_once_and_skip_zero_output(
    chain: Chain,
) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    Wrapper::push_from(&chain, account!("lender"))
        .lend(f.market, false, 100_000_000)
        .get()?;
    Wrapper::push_from(&chain, account!("alice"))
        .borrow(f.market, true, 80, 100)
        .get()?;
    Wrapper::push_from(&chain, account!("bob"))
        .stop(f.market, true, 90, 10_000)
        .get()?;
    Wrapper::push_from(&chain, account!("trader"))
        .trade(f.market, true, 200_000, 0, 256)
        .get()?;
    let rows = candles(&chain);
    assert_eq!(rows.len(), 5);
    assert!(
        rows.iter().all(|c| c.trades == 3),
        "aggregate seed, stop batch and liquidation must be counted exactly once"
    );
    let tiny = Wrapper::push_from(&chain, account!("lp"))
        .create(f.base, f.quote, 2, 2, 1, 1)
        .get()?;
    let result = Wrapper::push_from(&chain, account!("trader"))
        .trade(tiny, true, 1, 0, 64)
        .get()?;
    assert_eq!((result.0, result.1), (0, 0));
    assert!(
        candles(&chain).iter().all(|c| c.market != tiny),
        "refunded zero output has no price candle"
    );
    audit(&chain);
    Ok(())
}
