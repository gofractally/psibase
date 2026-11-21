//! Bounded atomic stop auctions. No owner enumeration and no persistent locks.
//! Simulation is pure; native financial writes begin only after feasibility.
use crate::{math::*, tables::tables::*};
use psibase::{AccountNumber, Table};

pub const MAX_STOPS: usize = 64;
pub const MAX_BOOKS: usize = 128;
pub const MAX_LOANS: usize = 64;
// Every relay segment ends at a book/trigger or terminates a leg. Each loan
// reverses direction at most once; each stop supplies at most one extra leg.
// Two simulations, each with <= (B+S+L+4)*(S+L+2) transitions, and each
// transition examines <= 2*(B+S+L+8) records. Deliberately conservative.
pub const MAX_WORK: u64 = (2
    * (MAX_BOOKS + MAX_STOPS + MAX_LOANS + 4)
    * (MAX_STOPS + MAX_LOANS + 2)
    * 2
    * (MAX_BOOKS + MAX_STOPS + MAX_LOANS + 8)) as u64;

pub fn direction(sell: bool) -> usize {
    if sell {
        0
    } else {
        1
    }
}

/// Remaining intrinsic generation capacity, independent of this taker's budget.
pub fn maker_input_capacity(p: &Pool) -> u64 {
    if p.shares == 0 || p.incoming >= MAX || p.index.get() >= (1_u128 << 80) {
        return 0;
    }
    let room = (1_u128 << 80) - 1 - p.index.get();
    let index_input = ((room + 1) * p.shares as u128 - 1) / Q;
    index_input.min((MAX - p.incoming) as u128) as u64
}

pub fn armed(market: u64) -> bool {
    StopBookTable::read()
        .get_index_pk()
        .range((market, false, 0)..=(market, true, u64::MAX))
        .next()
        .is_some()
}

pub fn book_count(market: u64) -> usize {
    BookTable::read()
        .get_index_pk()
        .range((market, false, 0)..=(market, true, u64::MAX))
        .take(MAX_BOOKS + 1)
        .count()
}

pub fn admit_book(market: u64) {
    if armed(market) {
        assert!(
            book_count(market) < MAX_BOOKS,
            "stop-enabled book price capacity"
        );
    }
}

#[derive(Clone)]
pub struct Seed {
    pub sell: bool,
    pub input: u64,
    pub limit: Option<u64>,
    pub min_output: u64,
    pub max_events: u32,
}

#[derive(Clone)]
pub struct Model {
    pub market: Market,
    pub books: Vec<Pool>,
    pub loans: Vec<Loan>,
    pub stops: Vec<StopPool>,
    pub time: u64,
}

#[derive(Clone)]
pub struct Plan {
    pub model: Model,
    pub activated: Vec<bool>,
    pub closed: Vec<bool>,
    pub totals: [u64; 2],
    pub used: [u64; 2],
    pub output: [u64; 2],
    pub seed_used: u64,
    pub seed_output: u64,
    pub work: u64,
    pub margin_first: bool,
    pub dirty_books: Vec<bool>,
    pending: [u64; 2],
    extra_margin: bool,
    early: Option<Vec<bool>>,
    barriers: Barriers,
    book_heads: [usize; 2],
    loan_heads: [usize; 2],
    stop_heads: [usize; 2],
}

#[derive(Clone)]
struct Barriers {
    books: Vec<u64>,
    loans: Vec<u64>,
    stops: Vec<u64>,
    book_order: [Vec<usize>; 2],
    loan_order: [Vec<usize>; 2],
    stop_order: [Vec<usize>; 2],
}
impl Barriers {
    fn prepare(model: &Model) -> Self {
        let m = &model.market;
        fn order(pairs: impl Iterator<Item = (bool, u64)>) -> [Vec<usize>; 2] {
            let pairs: Vec<_> = pairs.collect();
            let mut out = [Vec::new(), Vec::new()];
            for (i, (sell, _)) in pairs.iter().enumerate() {
                out[direction(*sell)].push(i);
            }
            out[0].sort_by_key(|i| u64::MAX - pairs[*i].1);
            out[1].sort_by_key(|i| pairs[*i].1);
            out
        }
        Self {
            book_order: order(model.books.iter().map(|p| (p.bid, p.price))),
            loan_order: order(model.loans.iter().map(|p| (p.long, p.price))),
            stop_order: order(model.stops.iter().map(|p| (p.sell_base, p.trigger))),
            books: model
                .books
                .iter()
                .map(|p| book_trigger(m.k.get(), p.bid, p.price, m.base_lot, m.quote_tick))
                .collect(),
            loans: model
                .loans
                .iter()
                .map(|p| trigger(m.k.get(), p.long, p.price, m.base_lot, m.quote_tick))
                .collect(),
            stops: model
                .stops
                .iter()
                .map(|p| stop_trigger(m.k.get(), p.sell_base, p.trigger, m.base_lot, m.quote_tick))
                .collect(),
        }
    }
}

impl Plan {
    fn tick(&mut self, n: usize) {
        self.work = self
            .work
            .checked_add(n as u64)
            .expect("auction work overflow");
        assert!(self.work <= MAX_WORK, "auction internal work bound");
    }

    fn latch(&mut self) {
        for side in 0..2 {
            loop {
                self.tick(1);
                let Some(i) = self.barriers.stop_order[side]
                    .get(self.stop_heads[side])
                    .copied()
                else {
                    break;
                };
                let reserve = if side == 0 {
                    self.model.market.x
                } else {
                    self.model.market.y
                };
                if reserve < self.barriers.stops[i] {
                    break;
                }
                let input = self.model.stops[i].input;
                self.totals[side] = add(self.totals[side], input);
                self.pending[side] = add(self.pending[side], input);
                self.activated[i] = true;
                self.stop_heads[side] += 1;
            }
        }
    }

    fn loan_head(&mut self, long: bool) -> Option<usize> {
        let side = direction(long);
        loop {
            self.tick(1);
            let i = self.barriers.loan_order[side]
                .get(self.loan_heads[side])
                .copied()?;
            if !self.closed[i] {
                return Some(i);
            }
            self.loan_heads[side] += 1;
        }
    }

    fn due_head(&mut self) -> Option<usize> {
        for long in [true, false] {
            if let Some(i) = self.loan_head(long) {
                let m = &self.model.market;
                if self.model.time >= m.maturity
                    || (if long { m.x } else { m.y }) >= self.barriers.loans[i]
                {
                    return Some(i);
                }
            }
        }
        None
    }

    fn close(&mut self, i: usize) {
        self.tick(1);
        let g = &self.model.loans[i];
        let (long, c, d) = (
            g.long,
            mul(g.units, g.collateral_unit),
            mul(g.units, g.face_unit),
        );
        let m = &mut self.model.market;
        let (a, b, out) = if long {
            relay(m.k.get(), m.x, m.y, c)
        } else {
            relay(m.k.get(), m.y, m.x, c)
        };
        assert!(out >= d, "auction liquidation certificate");
        if long {
            m.x = a;
            m.y = b;
            m.vault_quote = add(m.vault_quote, d);
            m.debt_quote -= d;
        } else {
            m.y = a;
            m.x = b;
            m.vault_base = add(m.vault_base, d);
            m.debt_base -= d;
        }
        let g = &mut self.model.loans[i];
        g.active = false;
        g.original_units = g.units;
        g.original_surplus = out - d;
        g.surplus = out - d;
        self.closed[i] = true;
        self.latch();
    }

    fn drain_due(&mut self) {
        while let Some(i) = self.due_head() {
            if self.early.as_ref().map(|p| !p[i]).unwrap_or(false) {
                self.extra_margin = true;
            }
            self.close(i);
        }
        self.latch();
    }

    fn book_head(&mut self, sell: bool, limit: Option<u64>) -> Option<usize> {
        let side = direction(sell);
        loop {
            self.tick(1);
            let i = self.barriers.book_order[side]
                .get(self.book_heads[side])
                .copied()?;
            let p = &self.model.books[i];
            if !p.active {
                self.book_heads[side] += 1;
                continue;
            }
            if limit
                .map(|lim| if sell { p.price < lim } else { p.price > lim })
                .unwrap_or(false)
            {
                return None;
            }
            return Some(i);
        }
    }

    /// Strict lot handling: touch the head even with sublot remainder; never
    /// skip it and move the relay through executable native price priority.
    fn leg(
        &mut self,
        sell: bool,
        input: u64,
        limit: Option<u64>,
        budget: u32,
        output_cap: u64,
    ) -> (u64, u64) {
        let (mut used, mut output, mut events) = (0, 0, 0_u32);
        let m = &self.model.market;
        let limit_barrier =
            limit.map(|price| book_trigger(m.k.get(), sell, price, m.base_lot, m.quote_tick));
        loop {
            self.tick(1);
            self.drain_due();
            if used == input || events >= budget || output == output_cap {
                break;
            }
            let m = &self.model.market;
            let u = if sell { m.x } else { m.y };
            let mut barrier = MAX;
            if let Some(i) = self.book_head(sell, limit) {
                let m = &self.model.market;
                let p = &self.model.books[i];
                let h = self.barriers.books[i];
                let (inlot, outlot) = if sell {
                    (m.base_lot, mul(p.price, m.quote_tick))
                } else {
                    (mul(p.price, m.quote_tick), m.base_lot)
                };
                if u >= h {
                    let capacity = maker_input_capacity(p);
                    if capacity < inlot {
                        self.model.books[i].active = false;
                        self.dirty_books[i] = true;
                        events += 1;
                        continue;
                    }
                    let lots = ((input - used) / inlot)
                        .min(p.outgoing / outlot)
                        .min((output_cap - output) / outlot)
                        .min(capacity / inlot);
                    if lots == 0 {
                        break;
                    }
                    let (a, b) = (mul(lots, inlot), mul(lots, outlot));
                    let p = &mut self.model.books[i];
                    let scaled = a as u128 * Q;
                    p.index = (p
                        .index
                        .get()
                        .checked_add(scaled / p.shares as u128)
                        .expect("auction maker index overflow"))
                    .into();
                    assert!(
                        p.index.get() < (1_u128 << 80),
                        "generation index limit; cancel and reopen"
                    );
                    p.dust = (p.dust.get() + scaled % p.shares as u128).into();
                    p.incoming = add(p.incoming, a);
                    p.outgoing -= b;
                    p.active = p.outgoing >= outlot && p.shares > 0;
                    self.dirty_books[i] = true;
                    used = add(used, a);
                    output = add(output, b);
                    events += 1;
                    continue;
                }
                barrier = barrier.min(h);
            }
            if let Some(i) = self.loan_head(sell) {
                barrier = barrier.min(self.barriers.loans[i]);
            }
            self.tick(1);
            let side = direction(sell);
            if let Some(i) = self.barriers.stop_order[side]
                .get(self.stop_heads[side])
                .copied()
            {
                barrier = barrier.min(self.barriers.stops[i]);
            }
            let m = &self.model.market;
            if let Some(h) = limit_barrier {
                if u >= h {
                    break;
                }
                barrier = barrier.min(h);
            }
            // A MAX reserve or an integer boundary with no executable lot is
            // terminal partial execution, not a retry or a persistent lock.
            if barrier <= u {
                break;
            }
            let mut step = (input - used).min(barrier - u);
            if step == 0 {
                break;
            }
            let mut result = if sell {
                relay(m.k.get(), m.x, m.y, step)
            } else {
                relay(m.k.get(), m.y, m.x, step)
            };
            let mut binary_work = 0;
            if result.2 > output_cap - output {
                let (mut lo, mut hi) = (0, step);
                while lo < hi {
                    binary_work += 1;
                    let mid = lo + (hi - lo + 1) / 2;
                    let out = if sell {
                        relay(m.k.get(), m.x, m.y, mid).2
                    } else {
                        relay(m.k.get(), m.y, m.x, mid).2
                    };
                    if out <= output_cap - output {
                        lo = mid;
                    } else {
                        hi = mid - 1;
                    }
                }
                step = lo;
                if step == 0 {
                    break;
                }
                result = if sell {
                    relay(m.k.get(), m.x, m.y, step)
                } else {
                    relay(m.k.get(), m.y, m.x, step)
                };
            }
            let (a, b, out) = result;
            if out == 0 {
                break;
            }
            if let Some(price) = limit {
                let priced = mul(price, m.quote_tick) as u128;
                let good = if sell {
                    out as u128 * m.base_lot as u128 >= step as u128 * priced
                } else {
                    out as u128 * priced >= step as u128 * m.base_lot as u128
                };
                if !good {
                    break;
                }
            }
            self.tick(binary_work);
            let m = &mut self.model.market;
            if sell {
                m.x = a;
                m.y = b;
            } else {
                m.y = a;
                m.x = b;
            }
            used = add(used, step);
            output = add(output, out);
            events += 1;
        }
        (used, output)
    }
}

fn simulate(
    model: &Model,
    seed: Option<&Seed>,
    early: Option<&[bool]>,
    barriers: &Barriers,
) -> Plan {
    let mut p = Plan {
        model: model.clone(),
        activated: vec![false; model.stops.len()],
        closed: vec![false; model.loans.len()],
        totals: [0; 2],
        used: [0; 2],
        output: [0; 2],
        seed_used: 0,
        seed_output: 0,
        work: 0,
        margin_first: early.is_some(),
        dirty_books: vec![false; model.books.len()],
        pending: [0; 2],
        extra_margin: false,
        early: early.map(|s| s.to_vec()),
        barriers: barriers.clone(),
        book_heads: [0; 2],
        loan_heads: [0; 2],
        stop_heads: [0; 2],
    };
    p.latch();
    if let Some(early) = early {
        for long in [true, false] {
            loop {
                let Some(i) = p.loan_head(long) else {
                    break;
                };
                if !early[i] {
                    break;
                }
                p.close(i);
            }
        }
    }
    p.drain_due();
    if let Some(seed) = seed {
        (p.seed_used, p.seed_output) =
            p.leg(seed.sell, seed.input, seed.limit, seed.max_events, MAX);
    }
    // A generation can latch once only, so there are <=MAX_STOPS nonempty
    // dequeues. New input is pooled by direction and all completed owners get
    // that direction's one final average and one pro-rata execution fraction.
    let preferred = seed.map(|s| direction(s.sell)).unwrap_or(0);
    while p.pending[0] > 0 || p.pending[1] > 0 {
        let side = if p.pending[preferred] > 0 {
            preferred
        } else {
            1 - preferred
        };
        let input = p.pending[side];
        p.pending[side] = 0;
        let (used, out) = p.leg(side == 0, input, None, u32::MAX, MAX - p.output[side]);
        p.used[side] = add(p.used[side], used);
        p.output[side] = add(p.output[side], out);
    }
    p
}

pub fn plan(model: &Model, seed: Option<&Seed>) -> Plan {
    assert!(
        model.books.len() <= MAX_BOOKS
            && model.stops.len() <= MAX_STOPS
            && model.loans.len() <= MAX_LOANS,
        "auction snapshot capacity"
    );
    let barriers = Barriers::prepare(model);
    let preparation_work =
        64 * (model.books.len() + model.loans.len() + model.stops.len() + 2) as u64;
    let mut causal = simulate(model, seed, None, &barriers);
    if let Some(seed) = seed {
        assert!(causal.seed_output >= seed.min_output, "minimum output");
    }
    // Only one replay. A nonmonotone or opposite-flow infeasibility never
    // produces an iterative search or prevents the original causal execution.
    let one_sided = seed
        .map(|seed| {
            seed.input > 0
                && causal
                    .closed
                    .iter()
                    .enumerate()
                    .all(|(i, closed)| !*closed || model.loans[i].long == seed.sell)
                && causal
                    .activated
                    .iter()
                    .enumerate()
                    .all(|(i, active)| !*active || model.stops[i].sell_base == seed.sell)
        })
        .unwrap_or(false);
    if one_sided && causal.closed.iter().any(|v| *v) {
        let mut first = simulate(model, seed, Some(&causal.closed), &barriers);
        let valid = !first.extra_margin
            && first
                .activated
                .iter()
                .enumerate()
                .all(|(i, active)| !*active || model.stops[i].sell_base == seed.unwrap().sell)
            && first.seed_used >= causal.seed_used
            && seed
                .map(|s| first.seed_output >= s.min_output)
                .unwrap_or(true);
        let total_work = causal.work.checked_add(first.work).unwrap();
        assert!(total_work <= MAX_WORK, "auction combined work bound");
        if valid {
            first.work = total_work;
            first.tick(preparation_work as usize);
            return first;
        }
        causal.work = total_work;
    }
    causal.tick(preparation_work as usize);
    causal
}

pub fn snapshot(m: &Market, time: u64) -> Model {
    let books: Vec<_> = BookTable::read()
        .get_index_pk()
        .range((m.id, false, 0)..=(m.id, true, u64::MAX))
        .take(MAX_BOOKS + 1)
        .map(|b| PoolTable::read().get_index_pk().get(&b.generation).unwrap())
        .collect();
    let loans: Vec<_> = LoanBookTable::read()
        .get_index_pk()
        .range((m.id, false, 0)..=(m.id, true, u64::MAX))
        .take(MAX_LOANS + 1)
        .map(|b| LoanTable::read().get_index_pk().get(&b.generation).unwrap())
        .collect();
    let stops: Vec<_> = StopBookTable::read()
        .get_index_pk()
        .range((m.id, false, 0)..=(m.id, true, u64::MAX))
        .take(MAX_STOPS + 1)
        .map(|b| {
            StopPoolTable::read()
                .get_index_pk()
                .get(&b.generation)
                .unwrap()
        })
        .collect();
    assert!(books.len() <= MAX_BOOKS, "stop-enabled book price capacity");
    assert!(
        stops.len() <= MAX_STOPS && loans.len() <= MAX_LOANS,
        "stop auction price capacity"
    );
    Model {
        market: m.clone(),
        books,
        loans,
        stops,
        time,
    }
}

/// Actual physical cash remains in the isolated market subaccount. These writes
/// only reclassify funded cash between relay, orders, credit and stop claims.
pub fn execute(
    m: &mut Market,
    owner: AccountNumber,
    seed: Option<Seed>,
    refund_seed: bool,
) -> (u64, u64, u32) {
    use crate::service as native;
    let original = snapshot(m, native::now());
    let p = plan(&original, seed.as_ref());
    if let Some(seed) = &seed {
        native::take(
            owner,
            m.id,
            if seed.sell { m.base } else { m.quote },
            seed.input,
        );
    }
    for (i, book) in p.model.books.iter().enumerate() {
        if !p.dirty_books[i] {
            continue;
        }
        PoolTable::read_write().put(book).unwrap();
        if !book.active {
            BookTable::read_write().erase(&(
                book.market,
                book.bid,
                native::priority(book.bid, book.price),
            ));
        }
    }
    for (i, g) in p.model.loans.iter().enumerate() {
        if p.closed[i] {
            native::put_loan(g);
            let c = mul(g.units, g.collateral_unit);
            let d = mul(g.units, g.face_unit);
            crate::Wrapper::emit().history().liquidated(
                m.id,
                g.long,
                g.price,
                c,
                d,
                g.original_surplus,
            );
            crate::candles::record(m.id, g.long, c, d + g.original_surplus, native::now());
        }
    }
    for side in 0..2 {
        if p.totals[side] == 0 {
            continue;
        }
        let id = native::next();
        let refund = p.totals[side] - p.used[side];
        StopBatchTable::read_write()
            .put(&StopBatch {
                id,
                market: m.id,
                sell_base: side == 0,
                input_total: p.totals[side],
                input_used: p.used[side],
                output_total: p.output[side],
                refund_total: refund,
                refund_remaining: refund,
                output_remaining: p.output[side],
                shares_remaining: p.totals[side],
                margin_first: p.margin_first,
                work_steps: p.work,
            })
            .unwrap();
        for (i, pool) in p.model.stops.iter().enumerate() {
            if p.activated[i] && direction(pool.sell_base) == side {
                let mut pool = pool.clone();
                pool.input = 0;
                pool.batch = Some(id);
                StopBookTable::read_write().erase(&(
                    pool.market,
                    pool.sell_base,
                    native::priority(pool.sell_base, pool.trigger),
                ));
                StopPoolTable::read_write().put(&pool).unwrap();
            }
        }
        if p.used[side] > 0 {
            crate::Wrapper::emit().history().stoptraded(
                m.id,
                side == 0,
                p.used[side],
                p.output[side],
                id,
                p.margin_first,
                p.work,
            );
            crate::candles::record(m.id, side == 0, p.used[side], p.output[side], native::now());
        }
    }
    if let Some(seed) = &seed {
        native::give(
            owner,
            m.id,
            if seed.sell { m.quote } else { m.base },
            p.seed_output,
        );
        if refund_seed {
            native::give(
                owner,
                m.id,
                if seed.sell { m.base } else { m.quote },
                seed.input - p.seed_used,
            );
        }
        if p.seed_used > 0 {
            crate::Wrapper::emit().history().traded(
                m.id,
                owner,
                seed.sell,
                p.seed_used,
                p.seed_output,
            );
            crate::candles::record(m.id, seed.sell, p.seed_used, p.seed_output, native::now());
        }
    }
    *m = p.model.market;
    let count = p.activated.iter().filter(|v| **v).count() as u32;
    crate::Wrapper::emit().history().auctionwork(
        m.id,
        p.work,
        count,
        p.closed.iter().filter(|v| **v).count() as u32,
        p.margin_first,
    );
    (p.seed_used, p.seed_output, count)
}

#[cfg(test)]
#[path = "stop_math_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "stop_fuzz_tests.rs"]
mod fuzz_tests;
