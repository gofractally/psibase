//! Fixed-fixture timing and state reproducibility, not wall-clock assertions.
use super::metrics::measure;
use super::*;

#[psibase::test_case(packages("Exchange"))]
fn deterministic_fixture_forks_and_native_baseline_time(chain: Chain) -> Result<(), Error> {
    chain.start_block_at("2031-01-01T00:00:00Z".parse().unwrap());
    let f = setup(&chain, true)?;
    chain.finish_block();
    let before = state(&chain);
    let mut expected = None;
    for repeat in 0..8 {
        let sample = chain.fork();
        let result = measure(
            "baseline_relay_trade",
            json!({"repeat":repeat,"seed":7001}),
            || {
                Wrapper::push_from(&sample, account!("trader"))
                    .trade(f.market, true, 10_000, 0, 256)
            },
        );
        let value = result.get()?;
        assert_eq!(
            *expected.get_or_insert(value),
            value,
            "fixture result changed"
        );
        audit(&sample);
        assert_eq!(state(&chain), before, "child changed parent fixture");
    }
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn deterministic_stop_transaction_time_is_independent_of_owner_count(
    chain: Chain,
) -> Result<(), Error> {
    chain.start_block_at("2031-01-01T00:00:00Z".parse().unwrap());
    let f = setup(&chain, true)?;
    for owners in [1_u64, 16, 128] {
        let fixture = chain.fork();
        let each = 25_600 / owners;
        let mut generation = None;
        for i in 0..owners {
            let name = format!(
                "holder{}{}",
                char::from(b'a' + (i / 26) as u8),
                char::from(b'a' + (i % 26) as u8)
            );
            let owner: AccountNumber = name.parse().unwrap();
            fixture.new_account(owner)?;
            Tokens::push_from(&fixture, owner)
                .setUserConf(BalanceFlags::AUTO_DEBIT.index(), true)
                .get()?;
            Tokens::push_from(&fixture, account!("issuer"))
                .credit(f.base, owner, each.into(), "".into())
                .get()?;
            Tokens::push_from(&fixture, owner)
                .credit(f.base, crate::SERVICE, each.into(), "".into())
                .get()?;
            let id = Wrapper::push_from(&fixture, owner)
                .stop(f.market, true, 99, each)
                .get()?;
            assert_eq!(*generation.get_or_insert(id), id);
        }
        fixture.finish_block();
        let parent_positions = fixture
            .open::<_, StopPositionTable>()
            .get_index_pk()
            .iter()
            .collect::<Vec<_>>();
        let mut expected = None;
        let mut expected_work = None;
        for repeat in 0..12 {
            let sample = fixture.fork();
            let result = measure(
                "same_price_stop_owners",
                json!({"repeat":repeat,"owners":owners,"input_total":25600,"seed":7002}),
                || {
                    Wrapper::push_from(&sample, account!("trader"))
                        .trade(f.market, true, 10_000, 0, 256)
                },
            );
            let outcome = result.get()?;
            assert_eq!(*expected.get_or_insert(outcome), outcome);
            let batch = sample
                .open::<_, StopBatchTable>()
                .get_index_pk()
                .iter()
                .next()
                .unwrap();
            assert_eq!(
                *expected_work.get_or_insert(batch.work_steps),
                batch.work_steps
            );
            println!(
                "EXCHANGE_WORK {}",
                json!({"scenario":"same_price_stop_owners","owners":owners,"repeat":repeat,"work_steps":batch.work_steps})
            );
            assert_eq!(
                serde_json::to_value(
                    sample
                        .open::<_, StopPositionTable>()
                        .get_index_pk()
                        .iter()
                        .collect::<Vec<_>>()
                )
                .unwrap(),
                serde_json::to_value(&parent_positions).unwrap(),
                "execution visited owner rows"
            );
            audit(&sample);
        }
    }
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn deterministic_full_capacity_stop_margin_book_timing_and_progress(
    chain: Chain,
) -> Result<(), Error> {
    chain.start_block_at("2031-01-01T00:00:00Z".parse().unwrap());
    let f = setup(&chain, true)?;
    Wrapper::push_from(&chain, account!("lender"))
        .lend(f.market, false, 1_000_000)
        .get()?;
    let a = Wrapper::push_from(&chain, account!("alice"));
    let b = Wrapper::push_from(&chain, account!("bob"));
    for price in 1..=64 {
        a.borrow(f.market, true, price, 1).get()?;
    }
    for price in 1..=64 {
        b.limit(f.market, true, price, price * 100).get()?;
    }
    for price in 200..264 {
        b.limit(f.market, false, price, 100).get()?;
    }
    for price in 36..100 {
        a.stop(f.market, true, price, 100).get()?;
    }
    chain.finish_block();
    let before = state(&chain);
    let mut expected = None;
    let mut expected_work = None;
    for repeat in 0..12 {
        let sample = chain.fork();
        let result = measure(
            "full_capacity_64_stops_64_loans_128_prices",
            json!({"repeat":repeat,"seed":7003,"stops":64,"loans":64,"books":128}),
            || {
                Wrapper::push_from(&sample, account!("trader"))
                    .trade(f.market, true, 9_000_000, 0, 256)
            },
        );
        let outcome = result.get()?;
        assert!(
            outcome.0 > 0,
            "valid market input hung at the price boundary"
        );
        assert_eq!(*expected.get_or_insert(outcome), outcome);
        assert_eq!(
            sample
                .open::<_, StopBookTable>()
                .get_index_pk()
                .iter()
                .count(),
            0
        );
        assert_eq!(
            sample
                .open::<_, LoanBookTable>()
                .get_index_pk()
                .iter()
                .count(),
            0
        );
        let batch = sample
            .open::<_, StopBatchTable>()
            .get_index_pk()
            .iter()
            .next()
            .unwrap();
        assert_eq!(
            *expected_work.get_or_insert(batch.work_steps),
            batch.work_steps
        );
        assert!(batch.work_steps <= crate::stops::MAX_WORK);
        println!(
            "EXCHANGE_WORK {}",
            json!({"scenario":"full_capacity_64_stops_64_loans_128_prices","repeat":repeat,"work_steps":batch.work_steps,"work_bound":crate::stops::MAX_WORK,"margin_first":batch.margin_first})
        );
        audit(&sample);
        assert_eq!(state(&chain), before);
    }
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn deterministic_additional_stop_owners_interleaved_distribution(
    chain: Chain,
) -> Result<(), Error> {
    chain.start_block_at("2031-01-01T00:00:00Z".parse().unwrap());
    let f = setup(&chain, true)?;
    struct OwnerFixture {
        chain: Chain,
        owners: u64,
        positions: Value,
        state: Value,
    }
    // Finish all account/funding/storage preparation before warming or timing
    // any variant. Each fixture has the identical funded pool and market.
    let mut fixtures = Vec::new();
    for owners in [1_u64, 16, 128] {
        let fixture = chain.fork();
        let each = 25_600 / owners;
        let mut generation = None;
        for i in 0..owners {
            let owner: AccountNumber = format!(
                "holder{}{}",
                char::from(b'a' + (i / 26) as u8),
                char::from(b'a' + (i % 26) as u8)
            )
            .parse()
            .unwrap();
            fixture.new_account(owner)?;
            Tokens::push_from(&fixture, owner)
                .setUserConf(BalanceFlags::AUTO_DEBIT.index(), true)
                .get()?;
            Tokens::push_from(&fixture, account!("issuer"))
                .credit(f.base, owner, each.into(), "".into())
                .get()?;
            Tokens::push_from(&fixture, owner)
                .credit(f.base, crate::SERVICE, each.into(), "".into())
                .get()?;
            let id = Wrapper::push_from(&fixture, owner)
                .stop(f.market, true, 99, each)
                .get()?;
            assert_eq!(*generation.get_or_insert(id), id);
        }
        fixture.finish_block();
        audit(&fixture);
        let positions = serde_json::to_value(
            fixture
                .open::<_, StopPositionTable>()
                .get_index_pk()
                .iter()
                .collect::<Vec<_>>(),
        )
        .unwrap();
        assert_eq!(positions.as_array().unwrap().len(), owners as usize);
        let before = state(&fixture);
        fixtures.push(OwnerFixture {
            chain: fixture,
            owners,
            positions,
            state: before,
        });
    }

    let mut expected = None;
    let mut verify = |sample: &Chain, fixture: &OwnerFixture, outcome: (u64, u64, u32)| {
        assert_eq!(*expected.get_or_insert(outcome), outcome);
        assert_eq!(outcome.0, 10_000);
        let batches = sample
            .open::<_, StopBatchTable>()
            .get_index_pk()
            .iter()
            .collect::<Vec<_>>();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].input_total, 25_600);
        assert_eq!(batches[0].work_steps, 233);
        assert_eq!(
            serde_json::to_value(
                sample
                    .open::<_, StopPositionTable>()
                    .get_index_pk()
                    .iter()
                    .collect::<Vec<_>>()
            )
            .unwrap(),
            fixture.positions,
            "auction changed owner positions"
        );
        audit(sample);
        assert_eq!(state(&fixture.chain), fixture.state, "fork changed fixture");
        batches[0].work_steps
    };

    // Two untimed forks per fixture, alternating which variant is warmed first.
    for order in [[0, 1, 2], [2, 1, 0]] {
        for index in order {
            let fixture = &fixtures[index];
            let sample = fixture.chain.fork();
            let outcome = Wrapper::push_from(&sample, account!("trader"))
                .trade(f.market, true, 10_000, 0, 256)
                .get()?;
            verify(&sample, fixture, outcome);
        }
    }

    let permutations = [
        [0, 1, 2],
        [1, 2, 0],
        [2, 0, 1],
        [0, 2, 1],
        [2, 1, 0],
        [1, 0, 2],
    ];
    for repeat in 0..64 {
        let permutation = repeat % permutations.len();
        for (slot, index) in permutations[permutation].iter().copied().enumerate() {
            let fixture = &fixtures[index];
            let sample = fixture.chain.fork();
            let result = measure(
                "same_price_stop_owners_interleaved",
                json!({"repeat":repeat,"owners":fixture.owners,"input_total":25600,
                       "seed":7002,"seed_input":10000,"trigger":99,
                       "permutation":permutation,"order_slot":slot}),
                || {
                    Wrapper::push_from(&sample, account!("trader"))
                        .trade(f.market, true, 10_000, 0, 256)
                },
            );
            let work = verify(&sample, fixture, result.get()?);
            println!(
                "EXCHANGE_WORK {}",
                json!({"scenario":"same_price_stop_owners_interleaved","owners":fixture.owners,
                       "repeat":repeat,"work_steps":work,"permutation":permutation,
                       "order_slot":slot})
            );
        }
    }
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn deterministic_additional_stop_maximal_mixed_maturity_distribution(
    chain: Chain,
) -> Result<(), Error> {
    chain.start_block_at("2031-01-01T00:00:00Z".parse().unwrap());
    let f = setup(&chain, true)?;
    let alice = account!("alice");
    let bob = account!("bob");
    // All liquidity is ordinary native funding; token administration remains
    // burned. The initial issue leaves these quantities in the issuer wallet.
    for (token, owner, extra) in [
        (f.base, alice, 10_000_000_u64),
        (f.quote, bob, 3_000_000_000),
    ] {
        Tokens::push_from(&chain, account!("issuer"))
            .credit(token, owner, extra.into(), "".into())
            .get()?;
        Tokens::push_from(&chain, owner)
            .credit(token, crate::SERVICE, extra.into(), "".into())
            .get()?;
    }
    Wrapper::push_from(&chain, account!("lender"))
        .lend(f.market, true, 1_000_000)
        .get()?;
    Wrapper::push_from(&chain, account!("lender"))
        .lend(f.market, false, 100_000_000)
        .get()?;
    for price in 1..=32 {
        Wrapper::push_from(&chain, alice)
            .borrow(f.market, true, price, 50)
            .get()?;
    }
    for price in 200..232 {
        Wrapper::push_from(&chain, bob)
            .borrow(f.market, false, price, 50)
            .get()?;
    }
    for price in 1..=64 {
        Wrapper::push_from(&chain, alice)
            .limit(f.market, true, price, price * 100)
            .get()?;
    }
    for price in 200..264 {
        Wrapper::push_from(&chain, bob)
            .limit(f.market, false, price, 100)
            .get()?;
    }
    for price in 68..100 {
        Wrapper::push_from(&chain, alice)
            .stop(f.market, true, price, 400_000)
            .get()?;
    }
    for price in 101..133 {
        Wrapper::push_from(&chain, bob)
            .stop(f.market, false, price, 100_000_000)
            .get()?;
    }
    assert_eq!(
        chain.open::<_, BookTable>().get_index_pk().iter().count(),
        128
    );
    assert_eq!(
        chain
            .open::<_, LoanBookTable>()
            .get_index_pk()
            .iter()
            .count(),
        64
    );
    assert_eq!(
        chain
            .open::<_, StopBookTable>()
            .get_index_pk()
            .iter()
            .count(),
        64
    );
    audit(&chain);
    let owner_positions = serde_json::to_value(
        chain
            .open::<_, StopPositionTable>()
            .get_index_pk()
            .iter()
            .collect::<Vec<_>>(),
    )
    .unwrap();
    let borrower_positions = serde_json::to_value(
        chain
            .open::<_, BorrowerTable>()
            .get_index_pk()
            .iter()
            .collect::<Vec<_>>(),
    )
    .unwrap();
    chain.start_block_after(Seconds::from_ticks(32 * 86400).into());
    chain.finish_block();
    let before = state(&chain);
    let mut expected_state: [Option<Value>; 2] = [None, None];
    let mut expected_work = [None, None];
    let mut expected_trade = None;
    let mut expected_process = None;
    for repeat in 0..12 {
        // Alternate entry ordering while every action starts from a fresh fork
        // of exactly the same matured, maximally occupied market.
        let order = if repeat % 2 == 0 { [0, 1] } else { [1, 0] };
        for entry in order {
            let sample = chain.fork();
            let scenario = if entry == 0 {
                "maximal_mixed_64_stops_64_loans_128_prices_process"
            } else {
                "maximal_mixed_64_stops_64_loans_128_prices_one_atom_seed"
            };
            let metadata = json!({"repeat":repeat,"seed":7004,"stops":64,"loans":64,
                                  "books":128,"seed_atoms":entry,"entry":if entry==0{"process"}else{"trade"}});
            if entry == 0 {
                let result = measure(scenario, metadata, || {
                    Wrapper::push_from(&sample, account!("trader")).process(f.market)
                })
                .get()?;
                assert_eq!(*expected_process.get_or_insert(result), result);
                assert_eq!(result, 64);
            } else {
                let result = measure(scenario, metadata, || {
                    Wrapper::push_from(&sample, account!("trader")).trade(f.market, true, 1, 0, 1)
                })
                .get()?;
                assert_eq!(*expected_trade.get_or_insert(result), result);
                assert_eq!(
                    result.0, 1,
                    "minimal seed must complete or safely refund, not hang"
                );
                assert_eq!(result.2, 64);
            }
            assert_eq!(
                sample.open::<_, BookTable>().get_index_pk().iter().count(),
                0
            );
            assert_eq!(
                sample
                    .open::<_, LoanBookTable>()
                    .get_index_pk()
                    .iter()
                    .count(),
                0
            );
            assert_eq!(
                sample
                    .open::<_, StopBookTable>()
                    .get_index_pk()
                    .iter()
                    .count(),
                0
            );
            assert_eq!(
                sample
                    .open::<_, LoanTable>()
                    .get_index_pk()
                    .iter()
                    .filter(|g| !g.active)
                    .count(),
                64
            );
            assert_eq!(
                sample
                    .open::<_, StopPoolTable>()
                    .get_index_pk()
                    .iter()
                    .filter(|g| g.batch.is_some())
                    .count(),
                64
            );
            let batches = sample
                .open::<_, StopBatchTable>()
                .get_index_pk()
                .iter()
                .collect::<Vec<_>>();
            assert_eq!(batches.len(), 2);
            let work = batches[0].work_steps;
            for batch in &batches {
                assert_eq!(batch.work_steps, work);
                assert_eq!(
                    batch.input_total,
                    if batch.sell_base {
                        12_800_000
                    } else {
                        3_200_000_000
                    }
                );
                assert_eq!(batch.input_used, batch.input_total);
                assert_eq!(batch.refund_total, 0);
                assert!(batch.output_total > 0);
                assert!(
                    !batch.margin_first,
                    "opposed maturity flows retain causal ordering"
                );
            }
            assert_eq!(*expected_work[entry].get_or_insert(work), work);
            assert!(work <= crate::stops::MAX_WORK);
            println!(
                "EXCHANGE_WORK {}",
                json!({"scenario":scenario,"repeat":repeat,
                "work_steps":work,"work_bound":crate::stops::MAX_WORK,"margin_first":false})
            );
            assert_eq!(
                serde_json::to_value(
                    sample
                        .open::<_, StopPositionTable>()
                        .get_index_pk()
                        .iter()
                        .collect::<Vec<_>>()
                )
                .unwrap(),
                owner_positions
            );
            assert_eq!(
                serde_json::to_value(
                    sample
                        .open::<_, BorrowerTable>()
                        .get_index_pk()
                        .iter()
                        .collect::<Vec<_>>()
                )
                .unwrap(),
                borrower_positions
            );
            audit(&sample);
            let final_state = state(&sample);
            assert_eq!(
                &*expected_state[entry].get_or_insert_with(|| final_state.clone()),
                &final_state
            );
            assert_eq!(state(&chain), before, "benchmark fork changed the fixture");
        }
    }
    Ok(())
}
