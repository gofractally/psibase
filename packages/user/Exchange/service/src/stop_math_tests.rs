use super::*;

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
fn stop(id: u64, sell: bool, price: u64, input: u64) -> StopPool {
    StopPool {
        id,
        market: 1,
        sell_base: sell,
        trigger: price,
        input,
        shares: input,
        batch: None,
    }
}
fn model(market: Market, stops: Vec<StopPool>) -> Model {
    Model {
        market,
        books: vec![],
        loans: vec![],
        stops,
        time: 0,
    }
}
fn seed(sell: bool, input: u64) -> Seed {
    Seed {
        sell,
        input,
        limit: None,
        min_output: 0,
        max_events: 256,
    }
}
fn book(id: u64, bid: bool, price: u64, outgoing: u64) -> Pool {
    Pool {
        id,
        market: 1,
        bid,
        price,
        outgoing,
        incoming: 0,
        shares: outgoing,
        index: 0.into(),
        dust: 0.into(),
        active: true,
    }
}

fn live_zero_gap(sell: bool) -> (Model, u64) {
    let mut m = if sell {
        let mut value = market(77_781_745_931, 12_856_486_932, 60_500);
        value.quote_tick = 10_000;
        model(value, vec![])
    } else {
        model(market(12_856_486_932, 77_781_745_931, 10_000), vec![])
    };
    m.market.k = 1_000_000_000_110_001_900_002_u128.into();
    let price = if sell { 1 } else { 60_500 };
    m.books.push(book(2, sell, price, 100_000));
    (m, price)
}

#[test]
fn zero_output_gap_before_head_fills_market_and_limit_without_relay_donation() {
    for sell in [false, true] {
        let (m, price) = live_zero_gap(sell);
        let u = if sell { m.market.x } else { m.market.y };
        let v = if sell { m.market.y } else { m.market.x };
        let h = book_trigger(
            m.market.k.get(),
            sell,
            price,
            m.market.base_lot,
            m.market.quote_tick,
        );
        assert_eq!(h - u, 3, "exact live 60500 boundary");
        assert_eq!(relay(m.market.k.get(), u, v, h - u).2, 0);
        for limit in [None, Some(price)] {
            let mut s = seed(sell, 60_500);
            s.limit = limit;
            s.min_output = 10_000;
            s.max_events = 1;
            let p = plan(&m, Some(&s));
            assert_eq!((p.seed_used, p.seed_output), (60_500, 10_000));
            assert_eq!(
                (p.model.market.x, p.model.market.y, p.model.market.k.get()),
                (m.market.x, m.market.y, m.market.k.get())
            );
            let pool = &p.model.books[0];
            assert_eq!((pool.incoming, pool.outgoing), (60_500, 90_000));
            assert_eq!(
                pool.index.get() * pool.shares as u128 + pool.dust.get(),
                60_500 * Q
            );
            assert!(p.work < MAX_WORK);
        }
        let p = plan(&m, Some(&seed(sell, 60_499)));
        assert_eq!((p.seed_used, p.seed_output), (0, 0));
        assert_eq!(
            (p.model.market.x, p.model.market.y),
            (m.market.x, m.market.y)
        );
        assert!(!p.dirty_books[0]);
    }
}

#[test]
fn zero_gap_maker_does_not_bypass_limits_or_earlier_risk_boundaries() {
    for sell in [false, true] {
        let (mut m, price) = live_zero_gap(sell);
        let u = if sell { m.market.x } else { m.market.y };
        let v = if sell { m.market.y } else { m.market.x };
        let k = m.market.k.get();
        let h = book_trigger(k, sell, price, m.market.base_lot, m.market.quote_tick);
        for risk in [u + 1, h - 1, h] {
            assert!(!book_reachable(k, u, v, h, Some(risk)));
        }
        assert!(book_reachable(k, u, v, h, Some(h + 1)));
        assert!(
            !book_reachable(k, u, v, h + 100, None),
            "real relay output retains price priority"
        );
        let mut s = seed(sell, 60_500);
        s.limit = Some(if sell { price + 1 } else { price - 1 });
        assert_eq!(
            plan(&m, Some(&s)).seed_used,
            0,
            "maker outside reviewed limit"
        );
        m.stops.push(stop(3, sell, price, 60_500));
        let p = plan(&m, Some(&seed(sell, 60_500)));
        assert_eq!((p.seed_used, p.seed_output), (0, 0));
        assert!(
            !p.activated[0],
            "a zero-output gap cannot activate an un-crossed stop"
        );
    }
}

#[test]
#[should_panic(expected = "minimum output")]
fn zero_gap_maker_still_enforces_seed_minimum() {
    let (m, _) = live_zero_gap(false);
    let mut s = seed(false, 60_500);
    s.min_output = 10_001;
    plan(&m, Some(&s));
}

#[test]
fn sixty_four_stop_domino_completes_after_one_seed_event() {
    let stops = (0..64)
        .map(|i| stop(i + 1, true, 99_999_800 - i, 1_000_000))
        .collect();
    let m = model(market(1_000_000, 100_000_000, 1_000_000), stops);
    let mut s = seed(true, 1);
    s.max_events = 1;
    let p = plan(&m, Some(&s));
    assert_eq!(p.activated.iter().filter(|v| **v).count(), 64);
    assert_eq!(p.seed_used, 1);
    assert_eq!(p.totals[0], 64_000_000);
    assert_eq!(p.used[0], 64_000_000);
    assert!(p.output[0] > 0);
    assert!(p.work < MAX_WORK);
    assert_eq!(p.work, plan(&m, Some(&s)).work);
}

#[test]
fn margin_first_is_conditional_and_preserves_seed_protection() {
    let mut m = model(market(105, 96, 5), vec![stop(9, true, 3, 10)]);
    m.market.k = 10_000.into();
    m.market.debt_quote = 4;
    m.market.lending_quote = 4;
    m.loans.push(Loan {
        generation: 2,
        market: 1,
        long: true,
        price: 4,
        units: 1,
        collateral_unit: 10,
        face_unit: 4,
        active: true,
        original_units: 0,
        original_surplus: 0,
        surplus: 0,
    });
    let s = seed(true, 6);
    let p = plan(&m, Some(&s));
    assert!(p.margin_first);
    assert_eq!(p.seed_used, 6);
    assert_eq!(p.seed_output, 4);
    assert_eq!(p.model.loans[0].original_surplus, 5);
    let mut limited = s.clone();
    limited.limit = Some(4);
    let p = plan(&m, Some(&limited));
    assert!(!p.margin_first);
    assert_eq!(p.seed_used, 6);
    assert_eq!(p.seed_output, 5);
    limited.limit = None;
    limited.min_output = 5;
    let p = plan(&m, Some(&limited));
    assert!(!p.margin_first);
    assert_eq!(p.seed_output, 5);
}

#[test]
fn strict_book_lots_refund_and_do_not_skip_price_priority() {
    let mut m = model(market(10_000, 1_000_000, 100), vec![stop(1, true, 99, 100)]);
    m.market.quote_tick = 100;
    m.books.push(book(2, true, 100, 10_000));
    let p = plan(&m, Some(&seed(true, 99)));
    assert_eq!(p.seed_used, 0);
    assert_eq!(p.model.market.x, 10_000);
    assert!(!p.activated[0]);
    assert!(!p.dirty_books[0]);
    let p = plan(&m, Some(&seed(true, 100)));
    assert_eq!(p.seed_used, 100);
    assert_eq!(p.model.market.x, 10_000);
    assert!(p.dirty_books[0]);
}

#[test]
fn zero_output_stop_is_refunded_without_retry_or_donation() {
    let mut m = model(market(999_999, 2, 1_000_000), vec![stop(1, true, 1, 1)]);
    m.market.k = 1_000_000.into();
    let p = plan(&m, Some(&seed(true, 1)));
    assert!(p.activated[0]);
    assert_eq!(p.seed_output, 1);
    assert_eq!(p.used[0], 0);
    assert_eq!(p.output[0], 0);
    assert_eq!(p.totals[0], 1);
}

#[test]
fn max_reserve_and_output_headroom_finish_with_partial_refunds() {
    let m = model(market(MAX - 10, MAX, 1), vec![stop(1, true, 1, MAX)]);
    let p = plan(&m, Some(&seed(true, 10)));
    assert!(p.activated[0]);
    assert!(p.model.market.x <= MAX);
    assert!(p.used[0] < MAX);
    assert!(p.work < MAX_WORK);
    let mut m = model(market(1000, 1_000_000, 1), vec![stop(1, true, 1000, MAX)]);
    m.books = vec![book(2, true, 1000, MAX), book(3, true, 999, MAX)];
    let p = plan(&m, None);
    assert_eq!(p.totals[0], MAX);
    assert!(p.output[0] <= MAX);
    assert!(p.used[0] < MAX);
    assert!(p.output[0] > MAX - 1001);
}

#[test]
fn historical_maker_capacity_is_terminal_not_an_auction_panic() {
    let mut m = model(market(1000, 1_000_000, 1), vec![stop(1, true, 1000, 10)]);
    let mut b = book(2, true, 1000, 10_000);
    b.index = ((1_u128 << 80) - 1).into();
    m.books.push(b);
    let p = plan(&m, None);
    assert!(p.used[0] > 0 && p.output[0] > 0);
    assert!(p.dirty_books[0]);
    assert!(!p.model.books[0].active);
    assert_eq!(p.model.books[0].outgoing, m.books[0].outgoing);
    m.books[0].index = 0.into();
    m.books[0].incoming = MAX;
    let p = plan(&m, None);
    assert!(p.used[0] > 0 && p.output[0] > 0);
    assert!(p.dirty_books[0]);
    assert!(!p.model.books[0].active);
    assert_eq!(p.model.books[0].incoming, MAX);
}

#[test]
fn buy_stops_and_maturity_direction_reversals_are_finite() {
    let m = model(
        market(1_000_000, 1_000_000, 1),
        vec![stop(1, false, 2, 100_000)],
    );
    let p = plan(&m, Some(&seed(false, 500_000)));
    assert!(p.activated[0]);
    assert!(p.used[1] > 0 && p.output[1] > 0);
    let mut m = model(
        market(1_000_000, 1_000_000, 1_000_000),
        vec![
            stop(1, true, 999_999, 1000),
            stop(2, false, 1_000_001, 1000),
        ],
    );
    m.time = 100;
    for (long, price) in [(true, 900_000), (false, 1_100_000)] {
        m.loans.push(Loan {
            generation: 10 + u64::from(long),
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
        if long {
            m.market.debt_quote = 1;
            m.market.lending_quote = 1;
        } else {
            m.market.debt_base = 1;
            m.market.lending_base = 1;
        }
    }
    let p = plan(&m, None);
    assert!(p.closed.iter().all(|v| *v));
    assert!(
        !p.margin_first,
        "no-seed and mixed-direction work keeps actual causal ordering"
    );
    assert!(p.activated.iter().any(|v| *v));
    assert!(p.work < MAX_WORK);
}
