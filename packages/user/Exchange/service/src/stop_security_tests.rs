//! Independent actual-chain stop security cases. Included as a child of tests.rs
//! so the existing physical escrow audit and complete rollback snapshot apply.
use super::*;

fn stop_pool(chain: &Chain, id: u64) -> StopPool {
    chain
        .open::<_, StopPoolTable>()
        .get_index_pk()
        .get(&id)
        .unwrap()
}
fn stop_batch(chain: &Chain, id: u64) -> StopBatch {
    chain
        .open::<_, StopBatchTable>()
        .get_index_pk()
        .get(&id)
        .unwrap()
}

#[psibase::test_case(packages("Exchange"))]
fn stop_owner_coalescing_cancellation_and_generation_replay(chain: Chain) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let alice = Wrapper::push_from(&chain, account!("alice"));
    let bob = Wrapper::push_from(&chain, account!("bob"));
    let generation = alice.stop(f.market, true, 90, 10_000).get()?;
    assert_eq!(alice.stop(f.market, true, 90, 5_000).get()?, generation);
    assert_eq!(bob.stop(f.market, true, 90, 7_000).get()?, generation);
    let positions: Vec<_> = chain
        .open::<_, StopPositionTable>()
        .get_index_pk()
        .iter()
        .filter(|p| p.generation == generation)
        .collect();
    assert_eq!(
        positions.len(),
        2,
        "same wallet must coalesce within a generation"
    );
    assert_eq!(
        positions
            .iter()
            .find(|p| p.owner == account!("alice"))
            .unwrap()
            .shares,
        15_000
    );
    assert_eq!(stop_pool(&chain, generation).input, 22_000);
    audit(&chain);
    // The caller cannot claim or cancel another account's generation position.
    rejects!(
        chain,
        Wrapper::push_from(&chain, account!("trader")).cancelstop(generation)
    );
    assert_eq!(alice.cancelstop(generation).get()?, (15_000, 0));
    assert_eq!(stop_pool(&chain, generation).input, 7_000);
    assert_eq!(bob.cancelstop(generation).get()?, (7_000, 0));
    audit(&chain);
    let replacement = alice.stop(f.market, true, 90, 1000).get()?;
    assert_ne!(
        replacement, generation,
        "closed generation identifiers must not be reused"
    );
    rejects!(chain, alice.cancelstop(generation));
    assert_eq!(stop_pool(&chain, replacement).input, 1000);
    alice.cancelstop(replacement).get()?;
    audit(&chain);
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn stop_book_caps_apply_to_all_writers_and_cancellation_is_an_escape(
    chain: Chain,
) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let a = Wrapper::push_from(&chain, account!("alice"));
    let b = Wrapper::push_from(&chain, account!("bob"));
    // 128 distinct passive ordinary prices, covering both directions.
    for p in 1..=64 {
        b.limit(f.market, true, p, p * 100).get()?;
    }
    for p in 200..264 {
        b.limit(f.market, false, p, 100).get()?;
    }
    // Legacy/ordinary books may exceed the auction cap before stops are armed.
    // Enabling stops must detect cap+1 rather than truncate the snapshot.
    b.limit(f.market, false, 264, 100).get()?;
    rejects!(chain, a.stop(f.market, true, 90, 100));
    b.cancel(f.market, false, 264).get()?;
    let first = a.stop(f.market, true, 90, 100).get()?;
    rejects!(chain, b.limit(f.market, false, 264, 100));
    // Increasing an existing price is not a new bucket.
    b.limit(f.market, false, 200, 100).get()?;
    b.cancel(f.market, false, 201).get()?;
    b.limit(f.market, false, 264, 100).get()?;
    // Stop admission is capped per market, across both directions, not wallets.
    let mut generations = vec![first];
    for p in 1..=31 {
        generations.push(a.stop(f.market, true, p, 100).get()?);
    }
    for p in 150..182 {
        generations.push(a.stop(f.market, false, p, p * 100).get()?);
    }
    assert_eq!(generations.len(), 64);
    rejects!(chain, a.stop(f.market, true, 64, 100));
    // Another owner's contribution at an existing level remains admissible.
    assert_eq!(b.stop(f.market, true, 90, 100).get()?, first);
    a.cancelstop(generations[1]).get()?;
    a.stop(f.market, true, 64, 100).get()?;
    audit(&chain);
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn stop_minimum_atom_triggers_sixty_four_prices_without_hanging(chain: Chain) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    // Fine trigger ticks but a very large ordinary execution lot: every trigger
    // below maps to X+1 under the native conservative integer trigger rule.
    let market = Wrapper::push_from(&chain, account!("lp"))
        .create(f.base, f.quote, 1_000_000, 100_000_000, 1_000_000, 1)
        .get()?;
    Tokens::push_from(&chain, account!("issuer"))
        .credit(f.base, account!("alice"), 100_000_000_u64.into(), "".into())
        .get()?;
    Tokens::push_from(&chain, account!("alice"))
        .credit(f.base, crate::SERVICE, 100_000_000_u64.into(), "".into())
        .get()?;
    let a = Wrapper::push_from(&chain, account!("alice"));
    let mut generations = vec![];
    for offset in 0..64 {
        let p = 99_999_800 - offset;
        assert_eq!(
            crate::math::trigger(100_000_000_000_000, true, p, 1_000_000, 1),
            1_000_001
        );
        generations.push(a.stop(market, true, p, 1_000_000).get()?);
    }
    // A one-atom seed is the smallest possible valid trade, so retrying smaller
    // increments cannot be the implementation's liveness mechanism.
    super::metrics::measure(
        "stop_minimum_atom_64_prices",
        json!({"stop_prices":64,"seed_atoms":1,"book_prices":0,"owners":1}),
        || Wrapper::push_from(&chain, account!("trader")).trade(market, true, 1, 0, 1),
    )
    .get()?;
    let batch = stop_pool(&chain, generations[0])
        .batch
        .expect("triggered stop batch");
    for generation in &generations {
        assert_eq!(stop_pool(&chain, *generation).batch, Some(batch));
    }
    let sealed = stop_batch(&chain, batch);
    assert_eq!(sealed.input_total, 64_000_000);
    assert_eq!(sealed.input_used + sealed.refund_total, sealed.input_total);
    assert!(sealed.output_total > 0 || sealed.refund_total == sealed.input_total);
    assert!(sealed.work_steps > 0 && sealed.work_steps <= crate::stops::MAX_WORK);
    audit(&chain);
    for generation in generations {
        a.claimstop(generation).get()?;
    }
    audit(&chain);
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn stop_pooled_claims_are_exact_and_replay_cannot_drain_other_books(
    chain: Chain,
) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let a = Wrapper::push_from(&chain, account!("alice"));
    let b = Wrapper::push_from(&chain, account!("bob"));
    let first = a.stop(f.market, true, 99, 10_003).get()?;
    assert_eq!(b.stop(f.market, true, 99, 20_007).get()?, first);
    let untouched = Wrapper::push_from(&chain, account!("lp"))
        .create(f.base, f.quote, 100_000, 10_000_000, 100, 100)
        .get()?;
    let unrelated_before = (
        native_market_balance(&chain, untouched, f.base),
        native_market_balance(&chain, untouched, f.quote),
    );
    Wrapper::push_from(&chain, account!("trader"))
        .trade(f.market, true, 10_000, 0, 64)
        .get()?;
    let batch = stop_batch(&chain, stop_pool(&chain, first).batch.unwrap());
    assert_eq!(batch.input_total, 30_010);
    let expected = |shares: u64| {
        (
            (shares as u128 * batch.refund_total as u128 / batch.input_total as u128) as u64,
            (shares as u128 * batch.output_total as u128 / batch.input_total as u128) as u64,
        )
    };
    assert_eq!(b.claimstop(first).get()?, expected(20_007));
    assert_eq!(a.claimstop(first).get()?, expected(10_003));
    audit(&chain);
    rejects!(chain, a.claimstop(first));
    assert_eq!(
        (
            native_market_balance(&chain, untouched, f.base),
            native_market_balance(&chain, untouched, f.quote)
        ),
        unrelated_before
    );
    audit(&chain);
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn stop_margin_first_invalid_limit_and_minout_use_causal_fallback(
    chain: Chain,
) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    Wrapper::push_from(&chain, account!("lender"))
        .lend(f.market, false, 100_000_000)
        .get()?;
    Wrapper::push_from(&chain, account!("alice"))
        .borrow(f.market, true, 90, 1000)
        .get()?;
    let generation = Wrapper::push_from(&chain, account!("bob"))
        .stop(f.market, true, 95, 1000)
        .get()?;
    audit(&chain);
    // Original causal execution reaches the long margin at90 after some seed
    // fills. Moving its200k collateral first would put price below limit80 and
    // eliminate the seed. Keep the executable causal plan, without a lock.
    let limited = chain.fork();
    super::metrics::measure(
        "stop_margin_first_limit_fallback",
        json!({"stop_prices":1,"loan_prices":1,"seed_limit":80}),
        || Wrapper::push_from(&limited, account!("trader")).limit(f.market, false, 80, 100_000),
    )
    .get()?;
    let batch = stop_batch(&limited, stop_pool(&limited, generation).batch.unwrap());
    assert!(
        !batch.margin_first,
        "invalidated seed must retain causal execution"
    );
    assert!(batch.work_steps <= crate::stops::MAX_WORK);
    assert!(
        limited
            .open::<_, MakerTable>()
            .get_index_pk()
            .get(&(account!("trader"), f.market, false, 80))
            .is_some(),
        "unexecuted seed remainder must remain funded as its limit order"
    );
    audit(&limited);

    // A high minimum output can invalidate only the reordered replay.
    let protected = chain.fork();
    let (_, received, _) = super::metrics::measure(
        "stop_margin_first_minout_fallback",
        json!({"stop_prices":1,"loan_prices":1,"seed_min_output":7_000_000}),
        || {
            Wrapper::push_from(&protected, account!("trader"))
                .trade(f.market, true, 100_000, 7_000_000, 64)
        },
    )
    .get()?;
    assert!(received >= 7_000_000);
    let batch = stop_batch(&protected, stop_pool(&protected, generation).batch.unwrap());
    assert!(!batch.margin_first);
    audit(&protected);
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn stop_opposed_maturity_calls_latch_both_directions_and_finish(chain: Chain) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let lender = Wrapper::push_from(&chain, account!("lender"));
    lender.lend(f.market, true, 1_000_000).get()?;
    lender.lend(f.market, false, 100_000_000).get()?;
    Wrapper::push_from(&chain, account!("alice"))
        .borrow(f.market, true, 80, 100)
        .get()?;
    Wrapper::push_from(&chain, account!("bob"))
        .borrow(f.market, false, 120, 200)
        .get()?;
    let down = Wrapper::push_from(&chain, account!("alice"))
        .stop(f.market, true, 99, 1000)
        .get()?;
    let up = Wrapper::push_from(&chain, account!("bob"))
        .stop(f.market, false, 101, 101_000)
        .get()?;
    let borrowers = serde_json::to_value(
        chain
            .open::<_, BorrowerTable>()
            .get_index_pk()
            .iter()
            .collect::<Vec<_>>(),
    )
    .unwrap();
    chain.start_block_after(Seconds::from_ticks(32 * 86400).to_unit().unwrap());
    super::metrics::measure(
        "stop_opposed_maturity",
        json!({"stop_prices":2,"loan_prices":2,"seed_atoms":0}),
        || Wrapper::push_from(&chain, account!("trader")).process(f.market),
    )
    .get()?;
    assert!(
        stop_pool(&chain, down).batch.is_some(),
        "downward wick must latch"
    );
    assert!(
        stop_pool(&chain, up).batch.is_some(),
        "upward reversal must latch"
    );
    let m = chain
        .open::<_, MarketTable>()
        .get_index_pk()
        .get(&f.market)
        .unwrap();
    assert_eq!((m.debt_base, m.debt_quote), (0, 0));
    assert!(chain
        .open::<_, LoanTable>()
        .get_index_pk()
        .iter()
        .filter(|g| g.market == f.market)
        .all(|g| !g.active));
    assert_eq!(
        serde_json::to_value(
            chain
                .open::<_, BorrowerTable>()
                .get_index_pk()
                .iter()
                .collect::<Vec<_>>()
        )
        .unwrap(),
        borrowers,
        "execution must never iterate/mutate individual borrower positions"
    );
    audit(&chain);
    let before = state(&chain);
    assert_eq!(
        Wrapper::push_from(&chain, account!("trader"))
            .process(f.market)
            .get()?,
        0
    );
    assert_eq!(state(&chain), before, "completed batch must not replay");
    Wrapper::push_from(&chain, account!("alice"))
        .claimstop(down)
        .get()?;
    Wrapper::push_from(&chain, account!("bob"))
        .claimstop(up)
        .get()?;
    audit(&chain);
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn stop_maximum_principal_caps_output_and_refunds_without_overflow(
    chain: Chain,
) -> Result<(), Error> {
    setup(&chain, true)?;
    let issuer = account!("issuer");
    let maximum = crate::math::MAX;
    // Native token balances can exceed an exchange component bound. Fund two
    // independent maker levels whose combined quote exceeds that bound.
    let issue = || -> Result<u32, Error> {
        let t = Tokens::push_from(&chain, issuer);
        let token = t
            .create(4.try_into().unwrap(), (maximum * 10).into())
            .get()?;
        let nft = t.getToken(token).get()?.nft_id;
        Nft::push_from(&chain, issuer).debit(nft, "".into()).get()?;
        t.mint(token, (maximum * 10).into(), "".into()).get()?;
        t.setTokenConf(token, 1, true).get()?;
        Nft::push_from(&chain, issuer).burn(nft).get()?;
        Ok(token)
    };
    let base = issue()?;
    let quote = issue()?;
    for (user, token, amount) in [
        (account!("lp"), base, 1_000_000),
        (account!("lp"), quote, 1_000_000_000),
        (account!("alice"), base, maximum),
        (account!("bob"), quote, maximum * 2),
        (account!("trader"), base, 1),
    ] {
        Tokens::push_from(&chain, issuer)
            .credit(token, user, amount.into(), "".into())
            .get()?;
        Tokens::push_from(&chain, user)
            .credit(token, crate::SERVICE, amount.into(), "".into())
            .get()?;
    }
    let market = Wrapper::push_from(&chain, account!("lp"))
        .create(base, quote, 1_000_000, 1_000_000_000, 1000, 1)
        .get()?;
    for price in [999_997, 999_996] {
        Wrapper::push_from(&chain, account!("bob"))
            .limit(market, true, price, maximum / price * price)
            .get()?;
    }
    let generation = Wrapper::push_from(&chain, account!("alice"))
        .stop(market, true, 999_998, maximum)
        .get()?;
    audit(&chain);
    super::metrics::measure(
        "stop_maximum_output_partial_refund",
        json!({"input_atoms":maximum,"maker_levels":2,"output_bound":maximum}),
        || Wrapper::push_from(&chain, account!("trader")).trade(market, true, 1, 0, 1),
    )
    .get()?;
    let batch = stop_batch(&chain, stop_pool(&chain, generation).batch.unwrap());
    assert_eq!(batch.input_total, maximum);
    assert_eq!(batch.input_used + batch.refund_total, maximum);
    assert!(batch.output_total > maximum / 2 && batch.output_total <= maximum);
    assert!(
        batch.refund_total > 0,
        "output capacity must finish with a funded refund"
    );
    assert!(batch.work_steps <= crate::stops::MAX_WORK);
    audit(&chain);
    assert_eq!(
        Wrapper::push_from(&chain, account!("alice"))
            .claimstop(generation)
            .get()?,
        (batch.refund_total, batch.output_total)
    );
    audit(&chain);
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn stop_seeded_native_state_sequence_preserves_cash_and_trade_progress(
    chain: Chain,
) -> Result<(), Error> {
    chain.start_block_at("2031-01-01T00:00:00Z".parse().unwrap());
    let f = setup(&chain, true)?;
    let lender = Wrapper::push_from(&chain, account!("lender"));
    lender.lend(f.market, true, 1_000_000).get()?;
    lender.lend(f.market, false, 100_000_000).get()?;
    Wrapper::push_from(&chain, account!("bob"))
        .limit(f.market, true, 80, 800_000)
        .get()?;
    Wrapper::push_from(&chain, account!("bob"))
        .limit(f.market, false, 120, 10_000)
        .get()?;
    let mut random = 0x2026_1121_5eed_u64;
    let mut executed_trades = 0;
    for step in 0..96 {
        // Deliberately wrapping test PRNG; financial arithmetic is checked.
        random = random
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let user = if random & 256 == 0 {
            account!("alice")
        } else {
            account!("bob")
        };
        let action = Wrapper::push_from(&chain, user);
        let before = state(&chain);
        let succeeded = match random % 8 {
            0 => action
                .stop(f.market, true, 99, 100 + random % 2000)
                .trace
                .error
                .is_none(),
            1 => action
                .stop(f.market, false, 101, 10_000 + random % 20_000)
                .trace
                .error
                .is_none(),
            2 | 3 => {
                let sell = random % 8 == 2;
                let input = if sell {
                    1000 + random % 10_000
                } else {
                    100_000 + random % 900_000
                };
                let (used, _, _) = super::metrics::measure(
                    "stop_seeded_state_trade",
                    json!({"seed":"0x202611215eed","step":step,"sell_base":sell}),
                    || {
                        Wrapper::push_from(&chain, account!("trader"))
                            .trade(f.market, sell, input, 0, 256)
                    },
                )
                .get()?;
                assert!(used > 0, "legal funded market seed must make progress");
                executed_trades += 1;
                true
            }
            4 => {
                let own = chain
                    .open::<_, StopPositionTable>()
                    .get_index_pk()
                    .iter()
                    .find(|p| p.owner == user);
                own.map(|p| action.cancelstop(p.generation).trace.error.is_none())
                    .unwrap_or(true)
            }
            5 => action
                .borrow(
                    f.market,
                    random & 512 == 0,
                    if random & 512 == 0 { 80 } else { 120 },
                    1,
                )
                .trace
                .error
                .is_none(),
            6 => {
                let own = chain
                    .open::<_, BorrowerTable>()
                    .get_index_pk()
                    .iter()
                    .find(|p| {
                        p.owner == user
                            && chain
                                .open::<_, LoanTable>()
                                .get_index_pk()
                                .get(&p.generation)
                                .unwrap()
                                .active
                    });
                own.map(|p| {
                    action
                        .repay(f.market, p.long, p.price, 1)
                        .trace
                        .error
                        .is_none()
                })
                .unwrap_or(true)
            }
            _ => Wrapper::push_from(&chain, account!("lp"))
                .addliq(f.market, 1000)
                .trace
                .error
                .is_none(),
        };
        if !succeeded {
            assert_eq!(
                state(&chain),
                before,
                "rejected generated action changed native state"
            );
        }
        audit(&chain);
    }
    assert!(executed_trades >= 20);
    for batch in chain.open::<_, StopBatchTable>().get_index_pk().iter() {
        assert!(batch.work_steps <= crate::stops::MAX_WORK);
        assert_eq!(batch.input_used + batch.refund_total, batch.input_total);
    }
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn stop_lp_resize_can_move_trigger_beyond_max_without_freezing_market(
    chain: Chain,
) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let lp = account!("lp");
    let market = Wrapper::push_from(&chain, lp)
        .create(f.base, f.quote, 1_000_000, 1_000_000, 1_000_000, 1)
        .get()?;
    let generation = Wrapper::push_from(&chain, account!("alice"))
        .stop(market, true, 1, 1_000_000)
        .get()?;
    assert_eq!(
        crate::math::trigger(1_000_000_000_000, true, 1, 1_000_000, 1),
        1_000_000_000
    );
    for token in [f.base, f.quote] {
        Tokens::push_from(&chain, account!("issuer"))
            .credit(token, lp, 2_000_000_000_u64.into(), "".into())
            .get()?;
        Tokens::push_from(&chain, lp)
            .credit(token, crate::SERVICE, 2_000_000_000_u64.into(), "".into())
            .get()?;
    }
    // Same spot ratio, valid bounded reserves; K increases enough that this
    // armed stop's reserve boundary moves above the exchange's reserve domain.
    super::metrics::measure(
        "stop_lp_resize_unreachable_trigger",
        json!({"initial_lp_supply":1_000_000,"added_lp_shares":1_999_000_000}),
        || Wrapper::push_from(&chain, lp).addliq(market, 1_999_000_000),
    )
    .get()?;
    let m = chain
        .open::<_, MarketTable>()
        .get_index_pk()
        .get(&market)
        .unwrap();
    assert_eq!((m.x, m.y), (2_000_000_000, 2_000_000_000));
    assert!(2_000_000_000_000_u64 > crate::math::MAX);
    assert!(stop_pool(&chain, generation).batch.is_none());
    assert_eq!(
        Wrapper::push_from(&chain, account!("trader"))
            .process(market)
            .get()?,
        0
    );
    let (used, out, _) = Wrapper::push_from(&chain, account!("trader"))
        .trade(market, true, 100, 0, 16)
        .get()?;
    assert!(
        used > 0 && out > 0,
        "unreachable stop must not freeze legal spot activity"
    );
    assert!(
        stop_pool(&chain, generation).batch.is_none(),
        "do not clamp a trigger into a false activation"
    );
    audit(&chain);
    assert_eq!(
        Wrapper::push_from(&chain, account!("alice"))
            .cancelstop(generation)
            .get()?,
        (1_000_000, 0)
    );
    audit(&chain);
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn stop_reversal_refunds_marketable_limit_remainder_without_posting_or_recursing(
    chain: Chain,
) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let lender = Wrapper::push_from(&chain, account!("lender"));
    lender.lend(f.market, true, 1_000_000).get()?;
    lender.lend(f.market, false, 100_000_000).get()?;
    Wrapper::push_from(&chain, account!("alice"))
        .borrow(f.market, true, 80, 100)
        .get()?;
    Wrapper::push_from(&chain, account!("bob"))
        .borrow(f.market, false, 120, 200)
        .get()?;
    Wrapper::push_from(&chain, account!("alice"))
        .stop(f.market, true, 99, 1000)
        .get()?;
    Wrapper::push_from(&chain, account!("bob"))
        .stop(f.market, false, 101, 30_000_000)
        .get()?;
    chain.start_block_after(Seconds::from_ticks(32 * 86400).to_unit().unwrap());
    let trader = account!("trader");
    let primary = |token| {
        chain
            .open::<_, tokens::tables::tables::BalanceTable>()
            .get_index_pk()
            .get(&(trader, token))
            .map(|r| r.balance.value)
            .unwrap_or(0)
    };
    let before_base = primary(f.base);
    let before_quote = primary(f.quote);
    // Independent integer sequence: matured long sells20k, short buys with4.8m,
    // then the initial sell reaches its80 boundary before queued stops execute.
    let k = 100_000_000_000_000_u128;
    let after_long_y = (k + 1_020_000 - 1) / 1_020_000;
    let after_short_y = after_long_y + 4_800_000;
    let after_short_x = ((k + after_short_y - 1) / after_short_y) as u64;
    let limit_x = crate::math::sqrt(k / 80);
    let expected_used = limit_x - after_short_x;
    let expected_refund = 500_000 - expected_used;
    assert!(expected_used > 0 && expected_refund >= 100);
    let returned = super::metrics::measure(
        "stop_opposing_reversal_limit_refund",
        json!({"limit":80,"seed_input":500_000,"opposing_stop_input":30_000_000}),
        || Wrapper::push_from(&chain, trader).limit(f.market, false, 80, 500_000),
    )
    .get()?;
    assert_eq!(
        returned, 0,
        "marketable remainder must be refunded, not rested"
    );
    assert!(chain
        .open::<_, MakerTable>()
        .get_index_pk()
        .get(&(trader, f.market, false, 80))
        .is_none());
    assert_eq!(primary(f.base) - before_base, expected_refund);
    assert!(
        primary(f.quote) - before_quote >= expected_used * 80,
        "all executed seed input must retain its original limit protection"
    );
    let m = chain
        .open::<_, MarketTable>()
        .get_index_pk()
        .get(&f.market)
        .unwrap();
    assert!(
        m.x < crate::math::book_trigger(m.k.get(), true, 80, m.base_lot, m.quote_tick),
        "opposing queued flow must actually reverse price across the limit"
    );
    assert_eq!((m.debt_base, m.debt_quote), (0, 0));
    assert_eq!(
        chain
            .open::<_, StopBatchTable>()
            .get_index_pk()
            .iter()
            .filter(|b| b.market == f.market)
            .count(),
        2,
        "one auction only: no recursive remainder replans"
    );
    audit(&chain);
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn exhausted_native_maker_retirement_keeps_late_join_claims_and_never_reactivates(
    chain: Chain,
) -> Result<(), Error> {
    setup(&chain, true)?;
    let issuer = account!("issuer");
    let maximum = crate::math::MAX;
    let price = crate::math::MAX_PRICE;
    let inlot = price * 256;
    assert_eq!(maximum - inlot, 255);
    let issue = || -> Result<u32, Error> {
        let t = Tokens::push_from(&chain, issuer);
        let token = t
            .create(4.try_into().unwrap(), (maximum * 10).into())
            .get()?;
        let nft = t.getToken(token).get()?.nft_id;
        Nft::push_from(&chain, issuer).debit(nft, "".into()).get()?;
        t.mint(token, (maximum * 10).into(), "".into()).get()?;
        t.setTokenConf(token, 1, true).get()?;
        Nft::push_from(&chain, issuer).burn(nft).get()?;
        Ok(token)
    };
    let base = issue()?;
    let quote = issue()?;
    for (owner, token, amount) in [
        (account!("lp"), base, 1),
        (account!("lp"), quote, maximum - 1),
        (account!("alice"), base, 2),
        (account!("bob"), base, 1),
        (account!("trader"), quote, inlot),
    ] {
        Tokens::push_from(&chain, issuer)
            .credit(token, owner, amount.into(), "".into())
            .get()?;
        Tokens::push_from(&chain, owner)
            .credit(token, crate::SERVICE, amount.into(), "".into())
            .get()?;
    }
    let market = Wrapper::push_from(&chain, account!("lp"))
        .create(base, quote, 1, maximum - 1, 1, 256)
        .get()?;
    Wrapper::push_from(&chain, account!("alice"))
        .limit(market, false, price, 2)
        .get()?;
    Wrapper::push_from(&chain, account!("trader"))
        .trade(market, false, inlot, 1, 4)
        .get()?;
    // Bob joins after the entire incoming history belongs to Alice. His entry
    // debt excludes it. After Alice exits, capacity returns, but a retired
    // generation still must not be relisted.
    Wrapper::push_from(&chain, account!("bob"))
        .limit(market, false, price, 1)
        .get()?;
    let own = chain
        .open::<_, MakerTable>()
        .get_index_pk()
        .get(&(account!("alice"), market, false, price))
        .unwrap();
    let generation = own.generation;
    let pool = chain
        .open::<_, PoolTable>()
        .get_index_pk()
        .get(&generation)
        .unwrap();
    assert_eq!(pool.incoming, inlot);
    assert!(pool.active && crate::stops::maker_input_capacity(&pool) < inlot);
    super::metrics::measure(
        "exhausted_maker_permissionless_retirement",
        json!({"incoming_headroom":255,"native_input_lot":inlot}),
        || Wrapper::push_from(&chain, account!("trader")).process(market),
    )
    .get()?;
    let pool = chain
        .open::<_, PoolTable>()
        .get_index_pk()
        .get(&generation)
        .unwrap();
    assert!(!pool.active);
    assert!(chain
        .open::<_, BookTable>()
        .get_index_pk()
        .get(&(market, false, price))
        .is_none());
    audit(&chain);
    assert_eq!(
        Wrapper::push_from(&chain, account!("alice"))
            .cancel(market, false, price)
            .get()?,
        (1, inlot)
    );
    let pool = chain
        .open::<_, PoolTable>()
        .get_index_pk()
        .get(&generation)
        .unwrap();
    assert!(
        crate::stops::maker_input_capacity(&pool) >= inlot,
        "claim really restored intrinsic capacity, testing sticky retirement"
    );
    assert!(!pool.active && pool.outgoing == 1);
    assert!(
        chain
            .open::<_, BookTable>()
            .get_index_pk()
            .get(&(market, false, price))
            .is_none(),
        "old owner exit must not reactivate retired depth"
    );
    assert_eq!(
        Wrapper::push_from(&chain, account!("bob"))
            .cancel(market, false, price)
            .get()?,
        (1, 0)
    );
    audit(&chain);
    Ok(())
}
