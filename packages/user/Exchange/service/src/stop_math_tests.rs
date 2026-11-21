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
