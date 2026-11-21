//! Exact production planner properties; no independent routing implementation.
#![allow(unexpected_cfgs)]
use super::*;

struct Rng(u64);
impl Rng {
    fn n(&mut self, max: u64) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0 % max
    }
}
fn market(x: u64, y: u64, lot: u64) -> Market {
    Market {
        id: 1,
        base: 1,
        quote: 2,
        base_lot: lot,
        quote_tick: 1,
        x,
        y,
        k: (x as u128 * y as u128).into(),
        lp_supply: 100,
        vault_base: 0,
        vault_quote: 0,
        debt_base: 0,
        debt_quote: 0,
        lending_base: 0,
        lending_quote: 0,
        maturity: 100,
        margin_enabled: Some(true),
    }
}
fn cash(model: &Model, activation: Option<&[bool]>, auction: Option<&Plan>) -> [u128; 2] {
    let m = &model.market;
    let mut cash = [
        m.x as u128 + m.vault_base as u128,
        m.y as u128 + m.vault_quote as u128,
    ];
    for p in &model.books {
        if p.bid {
            cash[1] += p.outgoing as u128;
            cash[0] += p.incoming as u128;
        } else {
            cash[0] += p.outgoing as u128;
            cash[1] += p.incoming as u128;
        }
    }
    for g in &model.loans {
        if g.active {
            cash[direction(g.long)] += g.units as u128 * g.collateral_unit as u128;
        } else {
            cash[1 - direction(g.long)] += g.surplus as u128;
        }
    }
    for (i, p) in model.stops.iter().enumerate() {
        if !activation.map(|a| a[i]).unwrap_or(false) {
            cash[direction(p.sell_base)] += p.input as u128;
        }
    }
    if let Some(p) = auction {
        for side in 0..2 {
            cash[side] += (p.totals[side] - p.used[side]) as u128;
            cash[1 - side] += p.output[side] as u128;
        }
    }
    cash
}
fn reconcile(original: &Model, p: &Plan, seed: Option<&Seed>) {
    let mut expected = cash(original, None, None);
    if let Some(s) = seed {
        let side = direction(s.sell);
        expected[side] += p.seed_used as u128;
        expected[1 - side] -= p.seed_output as u128;
    }
    assert_eq!(
        cash(&p.model, Some(&p.activated), Some(p)),
        expected,
        "physical-token identity"
    );
    assert!(p.model.market.x > 0 && p.model.market.y > 0);
    assert!(p.model.market.x as u128 * p.model.market.y as u128 >= p.model.market.k.get());
    for side in 0..2 {
        assert!(p.used[side] <= p.totals[side]);
        assert!(p.output[side] <= MAX);
    }
    assert!(p.work <= MAX_WORK);
}

#[test]
fn three_thousand_seeded_mixed_book_stop_plans_preserve_each_token() {
    let mut rng = Rng(0x729f_601d_a81c_375b);
    for _ in 0..3000 {
        let x = 10_000 + rng.n(10_000);
        let mut m = Model {
            market: market(x, x * 100, 100),
            books: vec![],
            loans: vec![],
            stops: vec![],
            time: 0,
        };
        for i in 0..rng.n(8) + 1 {
            let sell = rng.n(2) == 0;
            let price = if sell {
                8000 + rng.n(1900)
            } else {
                10_100 + rng.n(2000)
            };
            let input = if sell {
                100 + rng.n(2000)
            } else {
                price + rng.n(100_000)
            };
            m.stops.push(StopPool {
                id: i + 1,
                market: 1,
                sell_base: sell,
                trigger: price,
                input,
                shares: input,
                batch: None,
            });
        }
        for i in 0..rng.n(8) {
            let bid = rng.n(2) == 0;
            let price = if bid { 9000 - i * 10 } else { 11_000 + i * 10 };
            let outgoing = if bid {
                price * (1 + rng.n(5))
            } else {
                100 * (1 + rng.n(5))
            };
            m.books.push(Pool {
                id: 100 + i,
                market: 1,
                bid,
                price,
                outgoing,
                incoming: 0,
                shares: outgoing,
                index: 0.into(),
                dust: 0.into(),
                active: true,
            });
        }
        let sell = rng.n(2) == 0;
        let s = Seed {
            sell,
            input: 1 + rng.n(if sell { x / 2 } else { x * 50 }),
            limit: None,
            min_output: 0,
            max_events: 1 + rng.n(8) as u32,
        };
        let p = plan(&m, Some(&s));
        reconcile(&m, &p, Some(&s));
        let again = plan(&m, Some(&s));
        assert_eq!(
            (
                p.seed_used,
                p.seed_output,
                p.work,
                p.model.market.x,
                p.model.market.y
            ),
            (
                again.seed_used,
                again.seed_output,
                again.work,
                again.model.market.x,
                again.model.market.y
            )
        );
        assert_eq!(p.activated, again.activated);
    }
}

#[test]
fn two_hundred_maturity_plans_preserve_both_assets_and_close_every_loan() {
    let mut rng = Rng(0x1234_5678_9012_3456);
    for _ in 0..200 {
        let mut m = Model {
            market: market(1_000_000, 100_000_000, 100),
            books: vec![],
            loans: vec![],
            stops: vec![],
            time: 100,
        };
        for i in 0..8 {
            let long = i % 2 == 0;
            let price = if long { 9000 - i } else { 11_000 + i };
            let units = 1 + rng.n(3);
            let (c, f) = if long { (200, price) } else { (2 * price, 100) };
            m.loans.push(Loan {
                generation: i + 1,
                market: 1,
                long,
                price,
                units,
                collateral_unit: c,
                face_unit: f,
                active: true,
                original_units: 0,
                original_surplus: 0,
                surplus: 0,
            });
            if long {
                m.market.debt_quote += units * f;
                m.market.lending_quote += units * f;
            } else {
                m.market.debt_base += units * f;
                m.market.lending_base += units * f;
            }
            let stop_price = if long { 9999 - i } else { 10_001 + i };
            let input = if long { 1000 } else { 20_000 };
            m.stops.push(StopPool {
                id: 100 + i,
                market: 1,
                sell_base: long,
                trigger: stop_price,
                input,
                shares: input,
                batch: None,
            });
        }
        let p = plan(&m, None);
        reconcile(&m, &p, None);
        assert!(p.closed.iter().all(|v| *v));
        assert_eq!(p.model.market.debt_base, 0);
        assert_eq!(p.model.market.debt_quote, 0);
    }
}

#[test]
#[should_panic(expected = "minimum output")]
fn production_min_output_guard_rejects_before_commit() {
    let m = Model {
        market: market(1000, 100_000, 100),
        books: vec![],
        loans: vec![],
        stops: vec![],
        time: 0,
    };
    plan(
        &m,
        Some(&Seed {
            sell: true,
            input: 1,
            limit: None,
            min_output: MAX,
            max_events: 1,
        }),
    );
}

#[test]
fn buy_and_sell_seed_limits_cover_book_filtering_and_rounding() {
    let mut m = Model {
        market: market(10_000, 1_000_000, 100),
        books: vec![],
        loans: vec![],
        stops: vec![],
        time: 0,
    };
    for (bid, price, outgoing) in [(true, 9000, 90_000), (false, 12_000, 1000)] {
        m.books.push(Pool {
            id: price,
            market: 1,
            bid,
            price,
            outgoing,
            incoming: 0,
            shares: outgoing,
            index: 0.into(),
            dust: 0.into(),
            active: true,
        });
    }
    for (sell, limit, input) in [
        (true, 9500, 1000),
        (true, 8500, 1000),
        (false, 11_000, 100_000),
        (false, 13_000, 100_000),
    ] {
        let s = Seed {
            sell,
            input,
            limit: Some(limit),
            min_output: 0,
            max_events: 256,
        };
        let p = plan(&m, Some(&s));
        reconcile(&m, &p, Some(&s));
        assert!(p.seed_used > 0);
        if sell {
            assert!(p.seed_output as u128 * 100 >= p.seed_used as u128 * limit as u128);
        } else {
            assert!(p.seed_output as u128 * limit as u128 >= p.seed_used as u128 * 100);
        }
    }
    for (x, y, lot, sell, limit) in [(2, 5, 9, true, 10), (5, 2, 10, false, 9)] {
        let m = Model {
            market: market(x, y, lot),
            books: vec![],
            loans: vec![],
            stops: vec![],
            time: 0,
        };
        let s = Seed {
            sell,
            input: 1,
            limit: Some(limit),
            min_output: 0,
            max_events: 1,
        };
        let p = plan(&m, Some(&s));
        assert_eq!(p.seed_used, 0);
        reconcile(&m, &p, Some(&s));
    }
}

#[test]
fn relay_output_cap_binary_search_handles_both_sides_and_zero_room() {
    for sell in [true, false] {
        for gap in [0, 775, 100_775] {
            let (x, y, lot, price) = if sell {
                (1000, 1_000_000, 1, 1000)
            } else {
                (1_000_000, 1000, 1000, 1)
            };
            let mut m = Model {
                market: market(x, y, lot),
                books: vec![],
                loans: vec![],
                stops: vec![],
                time: 0,
            };
            let outlot = if sell { price } else { lot };
            let outgoing = (MAX - gap) / outlot * outlot;
            m.books.push(Pool {
                id: 1,
                market: 1,
                bid: sell,
                price,
                outgoing,
                incoming: 0,
                shares: outgoing,
                index: 0.into(),
                dust: 0.into(),
                active: true,
            });
            m.stops.push(StopPool {
                id: 2,
                market: 1,
                sell_base: sell,
                trigger: price,
                input: MAX,
                shares: MAX,
                batch: None,
            });
            let p = plan(&m, None);
            reconcile(&m, &p, None);
            assert!(p.used[direction(sell)] < MAX);
            assert!(p.output[direction(sell)] <= MAX);
        }
    }
    let mut m = Model {
        market: market(1000, 3000, 1),
        books: vec![],
        loans: vec![],
        stops: vec![],
        time: 0,
    };
    m.books.push(Pool {
        id: 1,
        market: 1,
        bid: true,
        price: 3,
        outgoing: MAX,
        incoming: 0,
        shares: MAX,
        index: 0.into(),
        dust: 0.into(),
        active: true,
    });
    m.stops.push(StopPool {
        id: 2,
        market: 1,
        sell_base: true,
        trigger: 3,
        input: MAX,
        shares: MAX,
        batch: None,
    });
    let p = plan(&m, None);
    assert_eq!(p.output[0], MAX);
    reconcile(&m, &p, None);
}

#[test]
fn existing_stops_becoming_unreachable_after_lp_resize_do_not_block_trading() {
    for (sell, lot, price, input) in [
        (true, 1_000_000, 1, 1_000_000),
        (false, 1, MAX_PRICE, MAX_PRICE),
    ] {
        let mut m = Model {
            market: market(2_000_000_000, 2_000_000_000, lot),
            books: vec![],
            loans: vec![],
            stops: vec![],
            time: 0,
        };
        assert!(stop_trigger(m.market.k.get(), sell, price, lot, 1) > MAX);
        m.stops.push(StopPool {
            id: 1,
            market: 1,
            sell_base: sell,
            trigger: price,
            input,
            shares: input,
            batch: None,
        });
        let s = Seed {
            sell,
            input: 1_000_000,
            limit: None,
            min_output: 0,
            max_events: 1,
        };
        let p = plan(&m, Some(&s));
        assert!(!p.activated[0]);
        assert_eq!(p.seed_used, s.input);
        reconcile(&m, &p, Some(&s));
    }
}

#[test]
fn short_price_trigger_and_unselected_tail_keep_prefix_safety() {
    for sell in [true, false] {
        let mut m = Model {
            market: market(1_000_000, 100_000_000, 100),
            books: vec![],
            loans: vec![],
            stops: vec![],
            time: 0,
        };
        for price in if sell { [9000, 5000] } else { [11_000, 20_000] } {
            let (c, f) = if sell { (200, price) } else { (2 * price, 100) };
            m.loans.push(Loan {
                generation: price,
                market: 1,
                long: sell,
                price,
                units: 1,
                collateral_unit: c,
                face_unit: f,
                active: true,
                original_units: 0,
                original_surplus: 0,
                surplus: 0,
            });
            if sell {
                m.market.debt_quote += f;
                m.market.lending_quote += f;
            } else {
                m.market.debt_base += f;
                m.market.lending_base += f;
            }
        }
        let s = Seed {
            sell,
            input: if sell { 60_000 } else { 6_000_000 },
            limit: None,
            min_output: 0,
            max_events: 256,
        };
        let p = plan(&m, Some(&s));
        assert!(p.margin_first);
        assert_eq!(p.closed.iter().filter(|v| **v).count(), 1);
        reconcile(&m, &p, Some(&s));
    }
}

#[test]
fn mixed_and_zero_seed_plans_cannot_authorize_prospective_reordering() {
    let mut m = Model {
        market: market(1_000_000, 1_000_000, 1_000_000),
        books: vec![],
        loans: vec![],
        stops: vec![],
        time: 100,
    };
    for (long, price) in [(true, 900_000), (false, 1_100_000)] {
        m.loans.push(Loan {
            generation: price,
            market: 1,
            long,
            price,
            units: 1,
            collateral_unit: 100,
            face_unit: 1,
            active: true,
            original_units: 0,
            original_surplus: 0,
            surplus: 0,
        });
    }
    m.market.debt_base = 1;
    m.market.debt_quote = 1;
    m.market.lending_base = 1;
    m.market.lending_quote = 1;
    for input in [0, 1] {
        let s = Seed {
            sell: true,
            input,
            limit: None,
            min_output: 0,
            max_events: 1,
        };
        let p = plan(&m, Some(&s));
        assert!(!p.margin_first);
        reconcile(&m, &p, Some(&s));
    }
    // A current opposite stop (e.g. crossed by a proposed LP resize) is also
    // enough to select actual-path ordering even when only long debt closes.
    m.loans.pop();
    m.market.debt_base = 0;
    m.market.lending_base = 0;
    m.stops.push(StopPool {
        id: 1,
        market: 1,
        sell_base: false,
        trigger: 999_999,
        input: 1000,
        shares: 1000,
        batch: None,
    });
    let s = Seed {
        sell: true,
        input: 1,
        limit: None,
        min_output: 0,
        max_events: 1,
    };
    let p = plan(&m, Some(&s));
    assert!(!p.margin_first);
    reconcile(&m, &p, Some(&s));
}

#[test]
fn maker_capacity_rejects_corrupt_or_empty_intrinsic_capacity() {
    let mut p = Pool {
        id: 1,
        market: 1,
        bid: true,
        price: 1,
        outgoing: 100,
        incoming: 0,
        shares: 0,
        index: 0.into(),
        dust: 0.into(),
        active: true,
    };
    assert_eq!(maker_input_capacity(&p), 0);
    p.shares = 100;
    p.index = (1_u128 << 80).into();
    assert_eq!(maker_input_capacity(&p), 0);
}

#[test]
#[should_panic(expected = "auction snapshot capacity")]
fn oversized_book_snapshot_rejects_before_any_simulation() {
    let mut m = Model {
        market: market(1000, 1000, 1),
        books: vec![],
        loans: vec![],
        stops: vec![],
        time: 0,
    };
    m.books = vec![
        Pool {
            id: 1,
            market: 1,
            bid: true,
            price: 1,
            outgoing: 1,
            incoming: 0,
            shares: 1,
            index: 0.into(),
            dust: 0.into(),
            active: true
        };
        MAX_BOOKS + 1
    ];
    plan(&m, None);
}

#[test]
#[should_panic(expected = "auction snapshot capacity")]
fn oversized_stop_snapshot_rejects_before_any_simulation() {
    let mut m = Model {
        market: market(1000, 1000, 1),
        books: vec![],
        loans: vec![],
        stops: vec![],
        time: 0,
    };
    m.stops = vec![
        StopPool {
            id: 1,
            market: 1,
            sell_base: true,
            trigger: 1,
            input: 1,
            shares: 1,
            batch: None
        };
        MAX_STOPS + 1
    ];
    plan(&m, None);
}

#[test]
#[should_panic(expected = "auction snapshot capacity")]
fn oversized_credit_snapshot_rejects_before_any_simulation() {
    let mut m = Model {
        market: market(1000, 1000, 1),
        books: vec![],
        loans: vec![],
        stops: vec![],
        time: 0,
    };
    m.loans = vec![
        Loan {
            generation: 1,
            market: 1,
            long: true,
            price: 1,
            units: 1,
            collateral_unit: 2,
            face_unit: 1,
            active: true,
            original_units: 0,
            original_surplus: 0,
            surplus: 0
        };
        MAX_LOANS + 1
    ];
    plan(&m, None);
}

#[cfg(extracted_stop_host)]
#[test]
fn actual_native_claim_arithmetic_preserves_exact_payout_and_dust() {
    let mut rng = Rng(0x6161_9191_5353_7171);
    for _ in 0..5000 {
        let shares: Vec<_> = (0..(1 + rng.n(12))).map(|_| 1 + rng.n(100_000)).collect();
        let total: u64 = shares.iter().sum();
        let refund = rng.n(total + 1);
        let output = rng.n(MAX);
        let mut b = crate::tables::tables::StopBatch {
            id: 1,
            market: 1,
            sell_base: true,
            input_total: total,
            input_used: total - refund,
            output_total: output,
            refund_total: refund,
            refund_remaining: refund,
            output_remaining: output,
            shares_remaining: total,
            margin_first: false,
            work_steps: 0,
        };
        let (mut paid_refund, mut paid_output) = (0_u64, 0_u64);
        for share in shares {
            let before = (b.refund_remaining, b.output_remaining, b.shares_remaining);
            let (r, o) = crate::actual_claim_step(&mut b, share);
            assert_eq!(r, (share as u128 * refund as u128 / total as u128) as u64);
            assert_eq!(o, (share as u128 * output as u128 / total as u128) as u64);
            assert_eq!(
                (b.refund_remaining, b.output_remaining, b.shares_remaining),
                (before.0 - r, before.1 - o, before.2 - share)
            );
            paid_refund += r;
            paid_output += o;
        }
        assert_eq!(b.shares_remaining, 0);
        assert_eq!(paid_refund + b.refund_remaining, refund);
        assert_eq!(paid_output + b.output_remaining, output);
        // Any remaining atoms are explicitly backed, nonwithdrawable dust.
    }
}
