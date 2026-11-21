//! Native Psibase exchange. Free balances remain in native shared-token rows.
//! Only irrevocably committed collateral/order/relay/lending cash enters escrow.
#![allow(non_snake_case)]
pub mod math;
pub mod snapshot;
pub mod tables;
#[cfg(test)]
mod tests;

#[psibase::service(name = "exchange", tables = "tables::tables")]
pub mod service {
    use crate::{math::*, tables::tables::*};
    use psibase::{
        services::{
            nft::Wrapper as Nft,
            tokens::{BalanceFlags, Wrapper as Tokens},
        },
        *,
    };
    const MAX_LOAN_PRICES: usize = 64;
    fn now() -> u64 {
        psibase::services::transact::Wrapper::call()
            .currentBlock()
            .time
            .seconds()
            .seconds as u64
    }
    fn priority(high: bool, p: u64) -> u64 {
        assert!(p > 0 && p <= MAX_PRICE, "price range");
        if high {
            MAX_PRICE - p
        } else {
            p
        }
    }
    fn next() -> u64 {
        let t = ConfigTable::read_write();
        let mut c = t.get_index_pk().get(&()).expect("initialize exchange");
        let id = c.next;
        c.next = c.next.checked_add(1).expect("generation exhaustion");
        t.put(&c).unwrap();
        id
    }
    fn market(id: u64) -> Market {
        let m = MarketTable::read()
            .get_index_pk()
            .get(&id)
            .expect("unknown market");
        assert!(
            m.margin_enabled.is_some(),
            "legacy market requires explicit escrow migration"
        );
        // Quarantine the whole book after any issuer-side reserve mutation;
        // never invite new deposits into its otherwise unaffected asset.
        escrow(m.id, m.base);
        escrow(m.id, m.quote);
        m
    }
    fn save(m: &Market) {
        check(m);
        MarketTable::read_write().put(m).unwrap();
    }
    fn subaccount(market: u64) -> String {
        format!("market-{market}")
    }
    fn escrow(market: u64, token: u32) -> Escrow {
        let e = EscrowTable::read()
            .get_index_pk()
            .get(&(market, token))
            .unwrap_or(Escrow {
                market,
                token,
                balance: 0,
            });
        let actual = Tokens::call()
            .getSubBal(token, subaccount(market))
            .map(|q| q.value)
            .unwrap_or(0);
        assert_eq!(
            actual, e.balance,
            "market escrow changed externally; deposits and withdrawals paused"
        );
        e
    }
    fn take(user: AccountNumber, market: u64, token: u32, n: u64) {
        if n == 0 {
            return;
        }
        let mut e = escrow(market, token);
        e.balance = e.balance.checked_add(n).expect("market escrow overflow");
        let t = Tokens::call();
        let incoming = t.getSharedBal(token, Wrapper::SERVICE, user).value;
        let first = incoming.min(n);
        if first > 0 {
            t.uncredit(token, user, first.into(), "exchange commitment".into());
        }
        if n > first {
            t.debit(
                token,
                user,
                (n - first).into(),
                "exchange commitment".into(),
            );
        }
        t.toSub(token, subaccount(market), n.into());
        EscrowTable::read_write().put(&e).unwrap();
    }
    fn give(user: AccountNumber, market: u64, token: u32, n: u64) {
        if n > 0 {
            let mut e = escrow(market, token);
            e.balance = e.balance.checked_sub(n).expect("market escrow underflow");
            let t = Tokens::call();
            t.fromSub(token, subaccount(market), n.into());
            t.credit(token, user, n.into(), "exchange settlement".into());
            EscrowTable::read_write().put(&e).unwrap();
        }
    }
    fn is_immutable(token: u32) -> bool {
        let t = Tokens::call().getToken(token);
        t.settings_value & 1 == 0
            && t.settings_value & 2 != 0
            && Nft::call().getNft(t.nft_id).is_none()
    }
    fn immutable(token: u32) {
        let t = Tokens::call().getToken(token);
        assert!(t.settings_value & 1 == 0, "token is frozen");
        assert!(
            t.settings_value & 2 != 0,
            "margin requires unrecallable tokens"
        );
        assert!(
            Nft::call().getNft(t.nft_id).is_none(),
            "margin requires burned token administration NFT (no future freeze)"
        );
    }
    fn credit_assets(m: &Market) {
        assert!(
            m.margin_enabled == Some(true),
            "market was not immutable at creation; create a new funded margin book"
        );
        immutable(m.base);
        immutable(m.quote);
    }
    fn loan_rows(m: u64, long: bool) -> Vec<LoanBook> {
        LoanBookTable::read()
            .get_index_pk()
            .range((m, long, 0)..=(m, long, u64::MAX))
            .collect()
    }
    fn head(m: u64, long: bool) -> Option<Loan> {
        let r = LoanBookTable::read()
            .get_index_pk()
            .range((m, long, 0)..=(m, long, u64::MAX))
            .next()?;
        LoanTable::read().get_index_pk().get(&r.generation)
    }
    fn book_head(m: u64, bid: bool) -> Option<Pool> {
        let r = BookTable::read()
            .get_index_pk()
            .range((m, bid, 0)..=(m, bid, u64::MAX))
            .next()?;
        PoolTable::read().get_index_pk().get(&r.generation)
    }
    fn check(m: &Market) {
        assert!(
            m.x > 0 && m.y > 0 && m.k.get() > 0 && m.lp_supply > 0,
            "positive relay"
        );
        amount(m.x as u128);
        amount(m.y as u128);
        assert!(m.x as u128 * m.y as u128 >= m.k.get(), "protected product");
        let mut count = 0;
        for long in [true, false] {
            let mut u = if long { m.x } else { m.y };
            let mut face = 0;
            let mut total_c = 0;
            for r in loan_rows(m.id, long) {
                count += 1;
                assert!(count <= MAX_LOAN_PRICES, "credit price capacity");
                let g = LoanTable::read().get_index_pk().get(&r.generation).unwrap();
                assert!(g.active && g.units > 0, "active loan index");
                let c = mul(g.units, g.collateral_unit);
                let d = mul(g.units, g.face_unit);
                total_c = add(total_c, c);
                face = add(face, d);
                u = u.max(trigger(m.k.get(), long, g.price, m.base_lot, m.quote_tick));
                assert!(
                    recovery(m.k.get(), u, c) >= d,
                    "liquidation schedule undercovered"
                );
                u = add(u, c);
            }
            assert_eq!(
                face,
                if long { m.debt_quote } else { m.debt_base },
                "vault debt mismatch"
            );
        }
        for (f, d, s) in [
            (m.vault_base, m.debt_base, m.lending_base),
            (m.vault_quote, m.debt_quote, m.lending_quote),
        ] {
            add(f, d);
            assert!(d == 0 || s > 0, "unowned credit");
        }
    }
    fn due(m: &Market, long: bool) -> bool {
        head(m.id, long)
            .map(|g| {
                now() >= m.maturity
                    || (if long { m.x } else { m.y })
                        >= trigger(m.k.get(), long, g.price, m.base_lot, m.quote_tick)
            })
            .unwrap_or(false)
    }
    fn pending(m: &Market) -> bool {
        due(m, true) || due(m, false)
    }
    fn relay_swap(m: &mut Market, sell: bool, n: u64) -> u64 {
        let (u, v, out) = if sell {
            relay(m.k.get(), m.x, m.y, n)
        } else {
            relay(m.k.get(), m.y, m.x, n)
        };
        if sell {
            m.x = u;
            m.y = v
        } else {
            m.y = u;
            m.x = v
        }
        out
    }
    fn put_loan(g: &Loan) {
        LoanTable::read_write().put(g).unwrap();
        let table = LoanBookTable::read_write();
        let key = (g.market, g.long, priority(g.long, g.price));
        if g.active && g.units > 0 {
            table
                .put(&LoanBook {
                    market: g.market,
                    long: g.long,
                    priority: key.2,
                    generation: g.generation,
                })
                .unwrap();
        } else {
            table.erase(&key);
        }
    }
    fn close_head(m: &mut Market, long: bool) {
        assert!(due(m, long), "no due cohort");
        let mut g = head(m.id, long).unwrap();
        let c = mul(g.units, g.collateral_unit);
        let d = mul(g.units, g.face_unit);
        let out = relay_swap(m, long, c);
        assert!(out >= d, "liquidation certificate failed");
        if long {
            m.vault_quote = add(m.vault_quote, d);
            m.debt_quote -= d;
        } else {
            m.vault_base = add(m.vault_base, d);
            m.debt_base -= d;
        }
        g.active = false;
        g.original_units = g.units;
        g.original_surplus = out - d;
        g.surplus = out - d;
        put_loan(&g);
        Wrapper::emit()
            .history()
            .liquidated(m.id, long, g.price, c, d, out - d);
    }
    fn claim_loan(user: AccountNumber, m: &Market, long: bool, p: u64) -> u64 {
        let table = BorrowerTable::read_write();
        let key = (user, m.id, long, p);
        let Some(pos) = table.get_index_pk().get(&key) else {
            return 0;
        };
        let mut g = LoanTable::read()
            .get_index_pk()
            .get(&pos.generation)
            .unwrap();
        if g.active {
            return 0;
        }
        let paid =
            amount(pos.units as u128 * g.original_surplus as u128 / g.original_units as u128);
        g.units -= pos.units;
        g.surplus -= paid;
        give(user, m.id, if long { m.quote } else { m.base }, paid);
        if g.units == 0 { /* dust retained as non-withdrawable protocol reserve */ }
        LoanTable::read_write().put(&g).unwrap();
        table.erase(&key);
        paid
    }
    fn pool_save(p: &mut Pool) {
        let m = market(p.market);
        let lot = if p.bid {
            mul(p.price, m.quote_tick)
        } else {
            m.base_lot
        };
        p.active = p.shares > 0 && p.outgoing >= lot;
        PoolTable::read_write().put(p).unwrap();
        let b = BookTable::read_write();
        let key = (p.market, p.bid, priority(p.bid, p.price));
        let existing = b.get_index_pk().get(&key);
        if existing
            .as_ref()
            .map(|r| r.generation != p.id)
            .unwrap_or(false)
        {
            return;
        }
        if p.active {
            b.put(&Book {
                market: p.market,
                bid: p.bid,
                priority: key.2,
                generation: p.id,
            })
            .unwrap();
        } else {
            b.erase(&key);
        }
    }
    fn cancel_own(user: AccountNumber, m: &Market, bid: bool, p: u64) -> (u64, u64) {
        let table = MakerTable::read_write();
        let key = (user, m.id, bid, p);
        let pos = table
            .get_index_pk()
            .get(&key)
            .expect("no order at this price");
        let mut pool = PoolTable::read()
            .get_index_pk()
            .get(&pos.generation)
            .unwrap();
        let earned = pos.shares as u128 * pool.index.get() - pos.debt.get();
        let paid = amount(earned / Q);
        let refund = amount(pos.shares as u128 * pool.outgoing as u128 / pool.shares as u128);
        pool.outgoing -= refund;
        pool.incoming -= paid;
        pool.shares -= pos.shares;
        pool.dust = (pool.dust.get() + earned % Q).into();
        table.erase(&key);
        give(user, m.id, if bid { m.quote } else { m.base }, refund);
        give(user, m.id, if bid { m.base } else { m.quote }, paid);
        if pool.shares == 0 {
            pool.dust = (pool.incoming as u128 * Q).into();
        }
        pool_save(&mut pool);
        (refund, paid)
    }
    fn fill(m: &Market, user: AccountNumber, pool: &mut Pool, lots: u64) -> (u64, u64) {
        let (inlot, outlot) = if pool.bid {
            (m.base_lot, mul(pool.price, m.quote_tick))
        } else {
            (mul(pool.price, m.quote_tick), m.base_lot)
        };
        let input = mul(lots, inlot);
        let output = mul(lots, outlot);
        assert!(lots > 0 && output <= pool.outgoing, "fill volume");
        let scaled = input as u128 * Q;
        pool.index = (pool
            .index
            .get()
            .checked_add(scaled / pool.shares as u128)
            .expect("index overflow"))
        .into();
        assert!(
            pool.index.get() < (1_u128 << 80),
            "generation index limit; cancel and reopen"
        );
        pool.dust = (pool.dust.get() + scaled % pool.shares as u128).into();
        pool.incoming = add(pool.incoming, input);
        pool.outgoing -= output;
        pool_save(pool);
        give(user, m.id, if pool.bid { m.quote } else { m.base }, output);
        (input, output)
    }
    fn route(
        m: &mut Market,
        user: AccountNumber,
        sell: bool,
        amount_in: u64,
        min_out: u64,
        budget: u32,
        limit_price: Option<u64>,
        refund_unused: bool,
    ) -> (u64, u64, u32) {
        assert!(
            amount_in > 0 && budget > 0 && budget <= 256,
            "trade amount/event budget"
        );
        amount(amount_in as u128);
        take(user, m.id, if sell { m.base } else { m.quote }, amount_in);
        let (mut used, mut out, mut events) = (0, 0, 0);
        while events < budget {
            if pending(m) {
                let long = due(m, true);
                close_head(m, long);
                events += 1;
                continue;
            }
            if used == amount_in {
                break;
            }
            let mut barrier = MAX;
            let u = if sell { m.x } else { m.y };
            if let Some(mut p) = book_head(m.id, sell).filter(|p| {
                limit_price
                    .map(|lim| if sell { p.price >= lim } else { p.price <= lim })
                    .unwrap_or(true)
            }) {
                let h = book_trigger(m.k.get(), sell, p.price, m.base_lot, m.quote_tick);
                let (inlot, outlot) = if sell {
                    (m.base_lot, mul(p.price, m.quote_tick))
                } else {
                    (mul(p.price, m.quote_tick), m.base_lot)
                };
                if u >= h && amount_in - used >= inlot {
                    let n = ((amount_in - used) / inlot).min(p.outgoing / outlot);
                    let (a, b) = fill(m, user, &mut p, n);
                    used += a;
                    out = add(out, b);
                    events += 1;
                    continue;
                }
                if amount_in - used >= inlot {
                    barrier = h;
                }
            }
            if let Some(g) = head(m.id, sell) {
                barrier = barrier.min(trigger(m.k.get(), sell, g.price, m.base_lot, m.quote_tick));
            }
            if let Some(lim) = limit_price {
                let h = book_trigger(m.k.get(), sell, lim, m.base_lot, m.quote_tick);
                if u >= h {
                    break;
                }
                barrier = barrier.min(h);
            }
            if barrier == MAX && u == MAX {
                break;
            }
            assert!(barrier > u, "router boundary");
            let step = (amount_in - used).min(barrier - u);
            let (nu, nv, received) = if sell {
                relay(m.k.get(), m.x, m.y, step)
            } else {
                relay(m.k.get(), m.y, m.x, step)
            };
            if let Some(lim) = limit_price {
                let priced = lim as u128 * m.quote_tick as u128;
                let good = if sell {
                    received as u128 * m.base_lot as u128 >= step as u128 * priced
                } else {
                    received as u128 * priced >= step as u128 * m.base_lot as u128
                };
                if !good {
                    break;
                }
            }
            if sell {
                m.x = nu;
                m.y = nv
            } else {
                m.y = nu;
                m.x = nv
            }
            give(user, m.id, if sell { m.quote } else { m.base }, received);
            used += step;
            out = add(out, received);
            events += 1;
        }
        if refund_unused {
            give(
                user,
                m.id,
                if sell { m.base } else { m.quote },
                amount_in - used,
            );
        }
        assert!(out >= min_out, "minimum output");
        if used > 0 {
            Wrapper::emit()
                .history()
                .traded(m.id, user, sell, used, out);
        }
        (used, out, events)
    }

    #[action]
    fn init() {
        assert_eq!(
            get_sender(),
            Wrapper::SERVICE,
            "service initialization authority"
        );
        if ConfigTable::read().get_index_pk().get(&()).is_none() {
            ConfigTable::read_write().put(&Config { next: 1 }).unwrap();
            Tokens::call().setUserConf(BalanceFlags::AUTO_DEBIT.index(), false);
        }
    }
    #[action]
    fn create(
        base: u32,
        quote: u32,
        base_amount: u64,
        quote_amount: u64,
        base_lot: u64,
        quote_tick: u64,
    ) -> u64 {
        assert!(
            base != quote && base_lot > 0 && quote_tick > 0,
            "market parameters"
        );
        assert!(
            base_amount >= base_lot && quote_amount >= quote_tick,
            "initial market depth"
        );
        amount(base_amount as u128);
        amount(quote_amount as u128);
        amount(base_lot as u128);
        amount(quote_tick as u128);
        for tid in [base, quote] {
            assert!(
                Tokens::call().getToken(tid).settings_value & 1 == 0,
                "untransferable token"
            );
        }
        let owner = get_sender();
        let id = next();
        let margin_enabled = Some(is_immutable(base) && is_immutable(quote));
        take(owner, id, base, base_amount);
        take(owner, id, quote, quote_amount);
        let k = base_amount as u128 * quote_amount as u128;
        let shares = sqrt(k);
        assert!(shares > 1, "initial liquidity too small");
        let m = Market {
            id,
            base,
            quote,
            base_lot,
            quote_tick,
            x: base_amount,
            y: quote_amount,
            k: k.into(),
            lp_supply: shares,
            vault_base: 0,
            vault_quote: 0,
            debt_base: 0,
            debt_quote: 0,
            lending_base: 0,
            lending_quote: 0,
            maturity: now() + 30 * 86400,
            margin_enabled,
        };
        save(&m);
        LiquidityTable::read_write()
            .put(&Liquidity {
                owner,
                market: id,
                shares: shares - 1,
            })
            .unwrap();
        // One permanently locked share preserves a nonempty relay while every
        // actual LP can redeem their entire owned position after credit clears.
        LiquidityTable::read_write()
            .put(&Liquidity {
                owner: AccountNumber::new(0),
                market: id,
                shares: 1,
            })
            .unwrap();
        id
    }
    #[action]
    fn trade(
        market: u64,
        sell_base: bool,
        amount: u64,
        min_output: u64,
        max_events: u32,
    ) -> (u64, u64, u32) {
        let mut m = self::market(market);
        let result = route(
            &mut m,
            get_sender(),
            sell_base,
            amount,
            min_output,
            max_events,
            None,
            true,
        );
        save(&m);
        result
    }
    #[action]
    fn limit(market: u64, bid: bool, price: u64, amount: u64) -> u64 {
        assert!(amount > 0, "positive order");
        crate::math::amount(amount as u128);
        let mut m = self::market(market);
        priority(bid, price);
        let mut remaining = amount;
        mul(price, m.quote_tick);
        let crossing_relay = (if bid { m.y } else { m.x })
            < book_trigger(m.k.get(), !bid, price, m.base_lot, m.quote_tick);
        let crossing_book = book_head(market, !bid)
            .map(|p| {
                if bid {
                    price >= p.price
                } else {
                    price <= p.price
                }
            })
            .unwrap_or(false);
        let already_funded = crossing_relay || crossing_book;
        if already_funded {
            let (used, _, _) = route(
                &mut m,
                get_sender(),
                !bid,
                amount,
                0,
                256,
                Some(price),
                false,
            );
            remaining -= used;
            save(&m);
        }
        let lot = if bid {
            mul(price, m.quote_tick)
        } else {
            m.base_lot
        };
        if remaining < lot {
            if already_funded {
                give(
                    get_sender(),
                    m.id,
                    if bid { m.quote } else { m.base },
                    remaining,
                );
            } else {
                panic!("order smaller than execution lot");
            }
            return 0;
        }
        post_limit(market, bid, price, remaining, already_funded)
    }
    fn post_limit(market: u64, bid: bool, price: u64, amount: u64, already_funded: bool) -> u64 {
        let m = self::market(market);
        priority(bid, price);
        assert!(amount > 0, "positive order");
        let qprice = mul(price, m.quote_tick);
        assert!(
            already_funded
                || (if bid { m.y } else { m.x })
                    >= book_trigger(m.k.get(), !bid, price, m.base_lot, m.quote_tick),
            "limit event budget exhausted before reaching price"
        );
        if let Some(other) = book_head(m.id, !bid) {
            assert!(
                if bid {
                    price < other.price
                } else {
                    price > other.price
                },
                "crossing limit order: trade first"
            );
        }
        let user = get_sender();
        let key = (user, market, bid, price);
        if let Some(old) = MakerTable::read().get_index_pk().get(&key) {
            if !PoolTable::read()
                .get_index_pk()
                .get(&old.generation)
                .unwrap()
                .active
            {
                cancel_own(user, &m, bid, price);
            }
        }
        let bkey = (market, bid, priority(bid, price));
        let mut pool = if let Some(b) = BookTable::read().get_index_pk().get(&bkey) {
            PoolTable::read().get_index_pk().get(&b.generation).unwrap()
        } else {
            assert!(
                amount >= if bid { qprice } else { m.base_lot },
                "order smaller than execution lot"
            );
            Pool {
                id: next(),
                market,
                bid,
                price,
                outgoing: 0,
                incoming: 0,
                shares: 0,
                index: 0_u128.into(),
                dust: 0_u128.into(),
                active: true,
            }
        };
        let shares = if pool.shares == 0 {
            amount
        } else {
            crate::math::amount(amount as u128 * pool.shares as u128 / pool.outgoing as u128)
        };
        assert!(shares > 0, "order share precision");
        let mut pos = MakerTable::read()
            .get_index_pk()
            .get(&key)
            .unwrap_or(Maker {
                owner: user,
                market,
                bid,
                price,
                generation: pool.id,
                shares: 0,
                debt: 0_u128.into(),
            });
        assert_eq!(pos.generation, pool.id, "old generation");
        if !already_funded {
            take(user, m.id, if bid { m.quote } else { m.base }, amount);
        }
        pos.shares = add(pos.shares, shares);
        pos.debt = (pos
            .debt
            .get()
            .checked_add(shares as u128 * pool.index.get())
            .unwrap())
        .into();
        pool.shares = add(pool.shares, shares);
        pool.outgoing = add(pool.outgoing, amount);
        MakerTable::read_write().put(&pos).unwrap();
        pool_save(&mut pool);
        shares
    }
    #[action]
    fn cancel(market: u64, bid: bool, price: u64) -> (u64, u64) {
        cancel_own(get_sender(), &self::market(market), bid, price)
    }
    #[action]
    fn settle(market: u64, bid: bool, price: u64) -> u64 {
        let m = self::market(market);
        let key = (get_sender(), market, bid, price);
        let mut pos = MakerTable::read()
            .get_index_pk()
            .get(&key)
            .expect("no position");
        let mut pool = PoolTable::read()
            .get_index_pk()
            .get(&pos.generation)
            .unwrap();
        let paid = amount((pos.shares as u128 * pool.index.get() - pos.debt.get()) / Q);
        pos.debt = (pos.debt.get() + paid as u128 * Q).into();
        pool.incoming -= paid;
        MakerTable::read_write().put(&pos).unwrap();
        PoolTable::read_write().put(&pool).unwrap();
        give(get_sender(), m.id, if bid { m.base } else { m.quote }, paid);
        paid
    }
    #[action]
    fn lend(market: u64, base: bool, amount: u64) -> u64 {
        let mut m = self::market(market);
        credit_assets(&m);
        let (f, d, s) = if base {
            (m.vault_base, m.debt_base, m.lending_base)
        } else {
            (m.vault_quote, m.debt_quote, m.lending_quote)
        };
        let n = if s == 0 {
            amount
        } else {
            crate::math::amount(amount as u128 * s as u128 / add(f, d) as u128)
        };
        assert!(amount > 0 && n > 0, "positive lending shares");
        take(
            get_sender(),
            m.id,
            if base { m.base } else { m.quote },
            amount,
        );
        if base {
            m.vault_base = add(f, amount);
            m.lending_base = add(s, n);
        } else {
            m.vault_quote = add(f, amount);
            m.lending_quote = add(s, n);
        }
        let key = (get_sender(), market, base);
        let mut pos = LenderTable::read()
            .get_index_pk()
            .get(&key)
            .unwrap_or(Lender {
                owner: get_sender(),
                market,
                base,
                shares: 0,
            });
        pos.shares = add(pos.shares, n);
        LenderTable::read_write().put(&pos).unwrap();
        save(&m);
        n
    }
    #[action]
    fn unlend(market: u64, base: bool, shares: u64) -> u64 {
        let mut m = self::market(market);
        let key = (get_sender(), market, base);
        let mut pos = LenderTable::read()
            .get_index_pk()
            .get(&key)
            .expect("no lending position");
        assert!(shares > 0 && shares <= pos.shares, "lender shares");
        let (f, d, s) = if base {
            (m.vault_base, m.debt_base, m.lending_base)
        } else {
            (m.vault_quote, m.debt_quote, m.lending_quote)
        };
        let n = amount(shares as u128 * add(f, d) as u128 / s as u128);
        assert!(
            n <= f,
            "lending cash committed; wait for repayment/maturity"
        );
        pos.shares -= shares;
        if base {
            m.vault_base -= n;
            m.lending_base -= shares;
        } else {
            m.vault_quote -= n;
            m.lending_quote -= shares;
        }
        LenderTable::read_write().put(&pos).unwrap();
        give(get_sender(), m.id, if base { m.base } else { m.quote }, n);
        save(&m);
        n
    }
    #[action]
    fn borrow(market: u64, long: bool, price: u64, units: u64) -> u64 {
        let mut m = self::market(market);
        credit_assets(&m);
        assert!(
            units > 0 && !pending(&m) && now() < m.maturity,
            "credit unavailable or due cohorts"
        );
        assert!(
            (if long { m.x } else { m.y })
                < trigger(m.k.get(), long, price, m.base_lot, m.quote_tick),
            "loan trigger must be beyond current price"
        );
        let user = get_sender();
        claim_loan(user, &m, long, price);
        let (c, f) = if long {
            (mul(2, m.base_lot), mul(price, m.quote_tick))
        } else {
            (mul(2, mul(price, m.quote_tick)), m.base_lot)
        };
        let collateral = mul(units, c);
        let debt = mul(units, f);
        let fee = ceil(f as u128, 100) as u64;
        assert!(fee < f, "loan advance precision");
        let advance = mul(units, f - fee);
        let repay_asset = if long { m.quote } else { m.base };
        take(user, m.id, if long { m.base } else { m.quote }, collateral);
        if long {
            assert!(advance <= m.vault_quote, "insufficient lending cash");
            m.vault_quote -= advance;
            m.debt_quote = add(m.debt_quote, debt);
        } else {
            assert!(advance <= m.vault_base, "insufficient lending cash");
            m.vault_base -= advance;
            m.debt_base = add(m.debt_base, debt);
        }
        let k = (market, long, priority(long, price));
        let mut g = if let Some(b) = LoanBookTable::read().get_index_pk().get(&k) {
            LoanTable::read().get_index_pk().get(&b.generation).unwrap()
        } else {
            Loan {
                generation: next(),
                market,
                long,
                price,
                units: 0,
                collateral_unit: c,
                face_unit: f,
                active: true,
                original_units: 0,
                original_surplus: 0,
                surplus: 0,
            }
        };
        g.units = add(g.units, units);
        let key = (user, market, long, price);
        let mut pos = BorrowerTable::read()
            .get_index_pk()
            .get(&key)
            .unwrap_or(Borrower {
                owner: user,
                market,
                long,
                price,
                generation: g.generation,
                units: 0,
            });
        assert_eq!(pos.generation, g.generation, "old loan generation");
        pos.units = add(pos.units, units);
        BorrowerTable::read_write().put(&pos).unwrap();
        put_loan(&g);
        save(&m);
        give(user, m.id, repay_asset, advance);
        advance
    }
    #[action]
    fn repay(market: u64, long: bool, price: u64, units: u64) -> u64 {
        let mut m = self::market(market);
        let key = (get_sender(), market, long, price);
        let t = BorrowerTable::read_write();
        let mut pos = t.get_index_pk().get(&key).expect("no loan");
        let mut g = LoanTable::read()
            .get_index_pk()
            .get(&pos.generation)
            .unwrap();
        assert!(
            g.active && units > 0 && units <= pos.units,
            "repay active units"
        );
        let d = mul(units, g.face_unit);
        let c = mul(units, g.collateral_unit);
        take(get_sender(), m.id, if long { m.quote } else { m.base }, d);
        if long {
            m.vault_quote = add(m.vault_quote, d);
            m.debt_quote -= d;
        } else {
            m.vault_base = add(m.vault_base, d);
            m.debt_base -= d;
        }
        pos.units -= units;
        g.units -= units;
        g.active = g.units > 0;
        if pos.units == 0 {
            t.erase(&key);
        } else {
            t.put(&pos).unwrap();
        }
        put_loan(&g);
        give(get_sender(), m.id, if long { m.base } else { m.quote }, c);
        save(&m);
        c
    }
    #[action]
    fn claim(market: u64, long: bool, price: u64) -> u64 {
        claim_loan(get_sender(), &self::market(market), long, price)
    }
    #[action]
    fn liquidate(market: u64, max_events: u32) -> u32 {
        assert!(max_events <= 256, "event budget");
        let mut m = self::market(market);
        let mut n = 0;
        while n < max_events && pending(&m) {
            let long = due(&m, true);
            close_head(&mut m, long);
            n += 1;
        }
        save(&m);
        n
    }
    #[action]
    fn addliq(market: u64, shares: u64) -> (u64, u64) {
        let mut m = self::market(market);
        assert!(shares > 0, "positive shares");
        let s = add(m.lp_supply, shares);
        let dx = amount(ceil(shares as u128 * m.x as u128, m.lp_supply as u128));
        let dy = amount(ceil(shares as u128 * m.y as u128, m.lp_supply as u128));
        take(get_sender(), m.id, m.base, dx);
        take(get_sender(), m.id, m.quote, dy);
        m.x = add(m.x, dx);
        m.y = add(m.y, dy);
        m.k = (m.x as u128 * m.y as u128).into();
        m.lp_supply = s;
        let key = (get_sender(), market);
        let mut pos = LiquidityTable::read()
            .get_index_pk()
            .get(&key)
            .unwrap_or(Liquidity {
                owner: get_sender(),
                market,
                shares: 0,
            });
        pos.shares = add(pos.shares, shares);
        LiquidityTable::read_write().put(&pos).unwrap();
        save(&m);
        (dx, dy)
    }
    #[action]
    fn remliq(market: u64, shares: u64) -> (u64, u64) {
        assert_ne!(
            get_sender(),
            AccountNumber::new(0),
            "locked protocol liquidity"
        );
        let mut m = self::market(market);
        let key = (get_sender(), market);
        let mut pos = LiquidityTable::read()
            .get_index_pk()
            .get(&key)
            .expect("no relay shares");
        assert!(
            shares > 0 && shares <= pos.shares && shares < m.lp_supply,
            "keep positive relay supply"
        );
        let s = m.lp_supply - shares;
        let dx = amount(shares as u128 * m.x as u128 / m.lp_supply as u128);
        let dy = amount(shares as u128 * m.y as u128 / m.lp_supply as u128);
        m.x -= dx;
        m.y -= dy;
        m.k = (m.x as u128 * m.y as u128).into();
        m.lp_supply = s;
        pos.shares -= shares;
        LiquidityTable::read_write().put(&pos).unwrap();
        save(&m);
        give(get_sender(), m.id, m.base, dx);
        give(get_sender(), m.id, m.quote, dy);
        (dx, dy)
    }
    #[action]
    fn renew(market: u64) {
        let mut m = self::market(market);
        assert!(
            m.debt_base == 0 && m.debt_quote == 0,
            "close credit before renewal"
        );
        m.maturity = now() + 30 * 86400;
        save(&m);
    }
    #[action]
    fn snapshot(owner: AccountNumber) -> String {
        assert_eq!(owner, get_sender(), "snapshot owner authority");
        crate::snapshot::read_exchange(owner)
    }
    #[event(history, public)]
    fn traded(market: u64, owner: AccountNumber, sell_base: bool, input: u64, output: u64) {}
    #[event(history, public)]
    fn liquidated(market: u64, long: bool, price: u64, collateral: u64, debt: u64, surplus: u64) {}
}
