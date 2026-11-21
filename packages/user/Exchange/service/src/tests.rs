//! Actual-chain tests: native token integration, actor isolation and independent
//! custody/share/credit accounting. These are not just arithmetic-model tests.
use crate::{math::Q, tables::tables::*, Wrapper};
use psibase::services::{
    nft::Wrapper as Nft,
    tokens::{BalanceFlags, Wrapper as Tokens},
};
use psibase::*;
use serde_json::{json, Value};
use std::collections::BTreeMap;

struct Fixture {
    market: u64,
    base: u32,
    quote: u32,
}
fn setup(chain: &Chain, immutable: bool) -> Result<Fixture, Error> {
    setup_tokens(chain, immutable, true)
}
fn setup_tokens(chain: &Chain, immutable: bool, unrecallable: bool) -> Result<Fixture, Error> {
    let issuer = account!("issuer");
    for user in [
        issuer,
        account!("lp"),
        account!("alice"),
        account!("bob"),
        account!("lender"),
        account!("trader"),
    ] {
        chain.new_account(user)?;
        Tokens::push_from(chain, user)
            .setUserConf(BalanceFlags::AUTO_DEBIT.index(), true)
            .get()?;
    }
    let issue = || -> Result<u32, Error> {
        let t = Tokens::push_from(chain, issuer);
        let id = t
            .create(4.try_into().unwrap(), 10_000_000_000_u64.into())
            .get()?;
        let nft = t.getToken(id).get()?.nft_id;
        Nft::push_from(chain, issuer).debit(nft, "".into()).get()?;
        t.mint(id, 10_000_000_000_u64.into(), "".into()).get()?;
        if unrecallable {
            t.setTokenConf(id, 1, true).get()?;
        }
        if immutable {
            Nft::push_from(chain, issuer).burn(nft).get()?;
        }
        Ok(id)
    };
    let base = issue()?;
    let quote = issue()?;
    for user in [
        account!("lp"),
        account!("alice"),
        account!("bob"),
        account!("lender"),
        account!("trader"),
    ] {
        for (id, n) in [(base, 10_000_000_u64), (quote, 1_000_000_000_u64)] {
            Tokens::push_from(chain, issuer)
                .credit(id, user, n.into(), "".into())
                .get()?;
            Tokens::push_from(chain, user)
                .credit(id, crate::SERVICE, n.into(), "".into())
                .get()?;
        }
    }
    let market = Wrapper::push_from(chain, account!("lp"))
        .create(base, quote, 1_000_000, 100_000_000, 100, 100)
        .get()?;
    audit(chain);
    Ok(Fixture {
        market,
        base,
        quote,
    })
}
fn state(chain: &Chain) -> Value {
    json!({
        "config":chain.open::<_,ConfigTable>().get_index_pk().iter().collect::<Vec<_>>(),
        "market":chain.open::<_,MarketTable>().get_index_pk().iter().collect::<Vec<_>>(),
        "pool":chain.open::<_,PoolTable>().get_index_pk().iter().collect::<Vec<_>>(),
        "book":chain.open::<_,BookTable>().get_index_pk().iter().collect::<Vec<_>>(),
        "maker":chain.open::<_,MakerTable>().get_index_pk().iter().collect::<Vec<_>>(),
        "loan":chain.open::<_,LoanTable>().get_index_pk().iter().collect::<Vec<_>>(),
        "loanbook":chain.open::<_,LoanBookTable>().get_index_pk().iter().collect::<Vec<_>>(),
        "borrower":chain.open::<_,BorrowerTable>().get_index_pk().iter().collect::<Vec<_>>(),
        "lender":chain.open::<_,LenderTable>().get_index_pk().iter().collect::<Vec<_>>(),
        "lp":chain.open::<_,LiquidityTable>().get_index_pk().iter().collect::<Vec<_>>(),
        "native":chain.open::<_,tokens::tables::tables::BalanceTable>().get_index_pk().iter().collect::<Vec<_>>(),
        "shared":chain.open::<_,tokens::tables::tables::SharedBalanceTable>().get_index_pk().iter().collect::<Vec<_>>(),
        "token_init":chain.open::<_,tokens::tables::tables::InitTable>().get_index_pk().iter().collect::<Vec<_>>(),
        "native_tokens":chain.open::<_,tokens::tables::tables::TokenTable>().get_index_pk().iter().collect::<Vec<_>>(),
        "native_user_config":chain.open::<_,tokens::tables::tables::UserConfigTable>().get_index_pk().iter().collect::<Vec<_>>(),
        "native_balance_config":chain.open::<_,tokens::tables::tables::BalanceConfigTable>().get_index_pk().iter().collect::<Vec<_>>(),
        "escrow":chain.open::<_,EscrowTable>().get_index_pk().iter().collect::<Vec<_>>(),
        "native_subaccounts":chain.open::<_,tokens::tables::tables::SubAccountTable>().get_index_pk().iter().collect::<Vec<_>>(),
        "native_sub_balances":chain.open::<_,tokens::tables::tables::SubAccountBalanceTable>().get_index_pk().iter().collect::<Vec<_>>()
        ,"stop_pool":chain.open::<_,StopPoolTable>().get_index_pk().iter().collect::<Vec<_>>()
        ,"stop_book":chain.open::<_,StopBookTable>().get_index_pk().iter().collect::<Vec<_>>()
        ,"stop_position":chain.open::<_,StopPositionTable>().get_index_pk().iter().collect::<Vec<_>>()
        ,"stop_batch":chain.open::<_,StopBatchTable>().get_index_pk().iter().collect::<Vec<_>>()
    })
}
macro_rules! rejects {
    ($chain:expr,$action:expr) => {{
        let before = state(&$chain);
        let result = $action;
        assert!(result.trace.error.is_some(), "unexpected success");
        assert_eq!(
            state(&$chain),
            before,
            "rejected action mutated accounting/native state"
        );
        audit(&$chain);
    }};
}
fn native_market_balance(chain: &Chain, market: u64, token: u32) -> u64 {
    let sub = chain
        .open::<_, tokens::tables::tables::SubAccountTable>()
        .get_index_pk()
        .get(&(crate::SERVICE, format!("market-{market}")));
    sub.and_then(|s| {
        chain
            .open::<_, tokens::tables::tables::SubAccountBalanceTable>()
            .get_index_pk()
            .get(&(s.id, token))
    })
    .map(|b| b.balance.value)
    .unwrap_or(0)
}
fn audit(chain: &Chain) {
    audit_with_deficits(chain, &[]);
}
fn audit_with_deficits(chain: &Chain, deficits: &[(u64, u32, u64)]) {
    let markets: Vec<_> = chain
        .open::<_, MarketTable>()
        .get_index_pk()
        .iter()
        .collect();
    let mut cash: BTreeMap<(u64, u32), u128> = BTreeMap::new();
    let mut units: BTreeMap<u64, u128> = BTreeMap::new();
    let mut maker_shares: BTreeMap<u64, u128> = BTreeMap::new();
    let mut maker_claims: BTreeMap<u64, u128> = BTreeMap::new();
    let mut stop_shares: BTreeMap<u64, u128> = BTreeMap::new();
    let mut batch_shares: BTreeMap<u64, u128> = BTreeMap::new();
    let mut batch_refunds: BTreeMap<u64, u128> = BTreeMap::new();
    let mut batch_outputs: BTreeMap<u64, u128> = BTreeMap::new();
    let mut armed_prices: BTreeMap<u64, usize> = BTreeMap::new();
    // Preload independent totals once. Re-reading every global table for each
    // market made the test auditor quadratic and obscured request CPU timings
    // in fixtures with more than 1,000 markets. The assertions are unchanged.
    let mut book_counts: BTreeMap<u64, usize> = BTreeMap::new();
    let mut lp_totals: BTreeMap<u64, u128> = BTreeMap::new();
    let mut lender_totals: BTreeMap<(u64, bool), u128> = BTreeMap::new();
    let mut market_loans: BTreeMap<u64, Vec<Loan>> = BTreeMap::new();
    let mut market_pools: BTreeMap<u64, Vec<Pool>> = BTreeMap::new();
    for row in chain.open::<_, BookTable>().get_index_pk().iter() {
        *book_counts.entry(row.market).or_default() += 1;
    }
    for row in chain.open::<_, LiquidityTable>().get_index_pk().iter() {
        *lp_totals.entry(row.market).or_default() += row.shares as u128;
    }
    for row in chain.open::<_, LenderTable>().get_index_pk().iter() {
        *lender_totals.entry((row.market, row.base)).or_default() += row.shares as u128;
    }
    for row in chain.open::<_, LoanTable>().get_index_pk().iter() {
        market_loans.entry(row.market).or_default().push(row);
    }
    for row in chain.open::<_, PoolTable>().get_index_pk().iter() {
        market_pools.entry(row.market).or_default().push(row);
    }
    for row in chain.open::<_, StopBookTable>().get_index_pk().iter() {
        let g = chain
            .open::<_, StopPoolTable>()
            .get_index_pk()
            .get(&row.generation)
            .unwrap();
        assert!(g.batch.is_none() && g.input > 0);
        assert_eq!((row.market, row.sell_base), (g.market, g.sell_base));
        assert_eq!(
            row.priority,
            if g.sell_base {
                crate::math::MAX_PRICE - g.trigger
            } else {
                g.trigger
            }
        );
        *armed_prices.entry(g.market).or_default() += 1;
    }
    for p in chain.open::<_, StopPositionTable>().get_index_pk().iter() {
        let g = chain
            .open::<_, StopPoolTable>()
            .get_index_pk()
            .get(&p.generation)
            .unwrap();
        assert!(p.shares > 0);
        *stop_shares.entry(g.id).or_default() += p.shares as u128;
        if let Some(id) = g.batch {
            let b = chain
                .open::<_, StopBatchTable>()
                .get_index_pk()
                .get(&id)
                .unwrap();
            assert!(b.input_total > 0 && b.market == g.market && b.sell_base == g.sell_base);
            *batch_refunds.entry(id).or_default() +=
                p.shares as u128 * b.refund_total as u128 / b.input_total as u128;
            *batch_outputs.entry(id).or_default() +=
                p.shares as u128 * b.output_total as u128 / b.input_total as u128;
        }
    }
    for g in chain.open::<_, StopPoolTable>().get_index_pk().iter() {
        assert_eq!(
            stop_shares.get(&g.id).copied().unwrap_or(0),
            g.shares as u128
        );
        if let Some(id) = g.batch {
            assert_eq!(g.input, 0);
            *batch_shares.entry(id).or_default() += g.shares as u128;
        } else {
            assert_eq!(g.input, g.shares);
            let row = chain.open::<_, StopBookTable>().get_index_pk().get(&(
                g.market,
                g.sell_base,
                if g.sell_base {
                    crate::math::MAX_PRICE - g.trigger
                } else {
                    g.trigger
                },
            ));
            if g.input > 0 {
                assert_eq!(
                    row.unwrap().generation,
                    g.id,
                    "armed input must remain discoverable"
                );
            } else {
                assert!(row.map(|r| r.generation != g.id).unwrap_or(true));
            }
            *cash
                .entry((
                    g.market,
                    if g.sell_base {
                        chain
                            .open::<_, MarketTable>()
                            .get_index_pk()
                            .get(&g.market)
                            .unwrap()
                            .base
                    } else {
                        chain
                            .open::<_, MarketTable>()
                            .get_index_pk()
                            .get(&g.market)
                            .unwrap()
                            .quote
                    },
                ))
                .or_default() += g.input as u128;
        }
    }
    for b in chain.open::<_, StopBatchTable>().get_index_pk().iter() {
        assert_eq!(
            b.input_used as u128 + b.refund_total as u128,
            b.input_total as u128
        );
        assert_eq!(
            batch_shares.get(&b.id).copied().unwrap_or(0),
            b.shares_remaining as u128
        );
        assert!(batch_refunds.get(&b.id).copied().unwrap_or(0) <= b.refund_remaining as u128);
        assert!(batch_outputs.get(&b.id).copied().unwrap_or(0) <= b.output_remaining as u128);
        assert!(b.refund_remaining <= b.refund_total && b.output_remaining <= b.output_total);
        let m = chain
            .open::<_, MarketTable>()
            .get_index_pk()
            .get(&b.market)
            .unwrap();
        *cash
            .entry((b.market, if b.sell_base { m.base } else { m.quote }))
            .or_default() += b.refund_remaining as u128;
        *cash
            .entry((b.market, if b.sell_base { m.quote } else { m.base }))
            .or_default() += b.output_remaining as u128;
    }
    for p in chain.open::<_, MakerTable>().get_index_pk().iter() {
        let g = chain
            .open::<_, PoolTable>()
            .get_index_pk()
            .get(&p.generation)
            .unwrap();
        let earned = p.shares as u128 * g.index.get() - p.debt.get();
        *maker_shares.entry(g.id).or_default() += p.shares as u128;
        *maker_claims.entry(g.id).or_default() += earned;
    }
    for p in chain.open::<_, BorrowerTable>().get_index_pk().iter() {
        *units.entry(p.generation).or_default() += p.units as u128;
    }
    for m in &markets {
        let armed = armed_prices.get(&m.id).copied().unwrap_or(0);
        assert!(armed <= 64);
        if armed > 0 {
            assert!(book_counts.get(&m.id).copied().unwrap_or(0) <= 128);
        }
        assert!(m.x as u128 * m.y as u128 >= m.k.get());
        *cash.entry((m.id, m.base)).or_default() += m.x as u128 + m.vault_base as u128;
        *cash.entry((m.id, m.quote)).or_default() += m.y as u128 + m.vault_quote as u128;
        let lp = lp_totals.get(&m.id).copied().unwrap_or(0);
        assert_eq!(lp, m.lp_supply as u128);
        for base in [true, false] {
            let shares = lender_totals.get(&(m.id, base)).copied().unwrap_or(0);
            assert_eq!(
                shares,
                if base {
                    m.lending_base
                } else {
                    m.lending_quote
                } as u128
            );
        }
        let mut debt_base = 0_u128;
        let mut debt_quote = 0_u128;
        for g in market_loans.get(&m.id).into_iter().flatten() {
            assert_eq!(
                units.get(&g.generation).copied().unwrap_or(0),
                g.units as u128
            );
            if g.active {
                let collateral = g.units as u128 * g.collateral_unit as u128;
                let debt = g.units as u128 * g.face_unit as u128;
                *cash
                    .entry((m.id, if g.long { m.base } else { m.quote }))
                    .or_default() += collateral;
                if g.long {
                    debt_quote += debt
                } else {
                    debt_base += debt
                }
            } else {
                *cash
                    .entry((m.id, if g.long { m.quote } else { m.base }))
                    .or_default() += g.surplus as u128;
            }
        }
        assert_eq!(debt_base, m.debt_base as u128);
        assert_eq!(debt_quote, m.debt_quote as u128);
        for long in [true, false] {
            let mut start = if long { m.x as u128 } else { m.y as u128 };
            for row in chain
                .open::<_, LoanBookTable>()
                .get_index_pk()
                .range((m.id, long, 0)..=(m.id, long, u64::MAX))
            {
                let g = chain
                    .open::<_, LoanTable>()
                    .get_index_pk()
                    .get(&row.generation)
                    .unwrap();
                assert!(g.active && g.long == long && g.market == m.id);
                // Independent sqrt via binary predicate, not the service's sqrt.
                let target = if long {
                    m.k.get() * m.base_lot as u128 / (g.price as u128 * m.quote_tick as u128)
                } else {
                    m.k.get() * g.price as u128 * m.quote_tick as u128 / m.base_lot as u128
                };
                let (mut lo, mut hi) = (0_u128, crate::math::MAX as u128 + 1);
                while lo + 1 < hi {
                    let mid = (lo + hi) / 2;
                    if mid * mid <= target {
                        lo = mid
                    } else {
                        hi = mid
                    }
                }
                start = start.max(lo);
                let c = g.units as u128 * g.collateral_unit as u128;
                let d = g.units as u128 * g.face_unit as u128;
                assert!(
                    d * start * (start + c) <= m.k.get() * c,
                    "joint schedule undercovered"
                );
                start += c;
            }
        }
        for p in market_pools.get(&m.id).into_iter().flatten() {
            assert_eq!(
                maker_shares.get(&p.id).copied().unwrap_or(0),
                p.shares as u128
            );
            assert_eq!(
                Q * p.incoming as u128,
                maker_claims.get(&p.id).copied().unwrap_or(0) + p.dust.get()
            );
            *cash
                .entry((m.id, if p.bid { m.quote } else { m.base }))
                .or_default() += p.outgoing as u128;
            *cash
                .entry((m.id, if p.bid { m.base } else { m.quote }))
                .or_default() += p.incoming as u128;
        }
    }
    for ((market, token), expected) in cash {
        let actual = native_market_balance(chain, market, token);
        let cached = chain
            .open::<_, EscrowTable>()
            .get_index_pk()
            .get(&(market, token))
            .map(|e| e.balance)
            .unwrap_or(0);
        assert_eq!(
            cached as u128, expected,
            "cached escrow must equal independent financial liabilities"
        );
        let deficit = deficits
            .iter()
            .find(|(m, t, _)| (*m, *t) == (market, token))
            .map(|(_, _, n)| *n)
            .unwrap_or(0);
        assert_eq!(
            actual as u128 + deficit as u128,
            expected,
            "isolated native escrow mismatch market {market} token {token}"
        );
        let primary = chain
            .open::<_, tokens::tables::tables::BalanceTable>()
            .get_index_pk()
            .get(&(crate::SERVICE, token))
            .map(|b| b.balance.value)
            .unwrap_or(0);
        assert_eq!(
            primary, 0,
            "committed assets must never remain in unscoped service primary cash"
        );
    }
}

#[psibase::test_case(packages("Exchange"))]
fn native_custody_revoke_and_actor_isolation(chain: Chain) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let alice = account!("alice");
    let bob = account!("bob");
    let before = native_market_balance(&chain, f.market, f.quote);
    Tokens::push_from(&chain, alice)
        .uncredit(f.quote, crate::SERVICE, 1_000_000_000_u64.into(), "".into())
        .get()?;
    rejects!(
        chain,
        Wrapper::push_from(&chain, alice).limit(f.market, true, 90, 90_000)
    );
    assert_eq!(native_market_balance(&chain, f.market, f.quote), before);
    Wrapper::push_from(&chain, bob)
        .limit(f.market, true, 90, 900_000)
        .get()?;
    rejects!(
        chain,
        Wrapper::push_from(&chain, alice).cancel(f.market, true, 90)
    );
    rejects!(chain, Wrapper::push_from(&chain, alice).remliq(f.market, 1));
    rejects!(chain, Wrapper::push_from(&chain, alice).snapshot(bob));
    Wrapper::push_from(&chain, bob)
        .cancel(f.market, true, 90)
        .get()?;
    audit(&chain);
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn hybrid_rounding_topups_and_native_rollback(chain: Chain) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let a = Wrapper::push_from(&chain, account!("alice"));
    let b = Wrapper::push_from(&chain, account!("bob"));
    let t = Wrapper::push_from(&chain, account!("trader"));
    a.limit(f.market, true, 90, 900_007).get()?;
    b.limit(f.market, true, 90, 900_007).get()?;
    a.limit(f.market, true, 90, 123_457).get()?;
    let own: Vec<_> = chain
        .open::<_, MakerTable>()
        .get_index_pk()
        .iter()
        .filter(|p| p.owner == account!("alice"))
        .collect();
    assert_eq!(own.len(), 1);
    rejects!(chain, t.trade(f.market, true, 200_000, 1_000_000_000, 64));
    t.trade(f.market, true, 60_000, 0, 64).get()?;
    audit(&chain);
    b.limit(f.market, true, 90, 100_003).get()?;
    audit(&chain);
    t.trade(f.market, true, 200_000, 0, 64).get()?;
    audit(&chain);
    a.settle(f.market, true, 90).get()?;
    a.cancel(f.market, true, 90).get()?;
    b.cancel(f.market, true, 90).get()?;
    audit(&chain);
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn pooled_liquidation_preserves_borrower_rows(chain: Chain) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let lend = Wrapper::push_from(&chain, account!("lender"));
    lend.lend(f.market, false, 100_000_000).get()?;
    for user in [account!("alice"), account!("bob")] {
        let a = Wrapper::push_from(&chain, user);
        a.borrow(f.market, true, 80, 100).get()?;
        a.borrow(f.market, true, 80, 7).get()?;
    }
    audit(&chain);
    let before = serde_json::to_value(
        chain
            .open::<_, BorrowerTable>()
            .get_index_pk()
            .iter()
            .collect::<Vec<_>>(),
    )
    .unwrap();
    Wrapper::push_from(&chain, account!("trader"))
        .trade(f.market, true, 500_000, 0, 64)
        .get()?;
    audit(&chain);
    assert_eq!(
        serde_json::to_value(
            chain
                .open::<_, BorrowerTable>()
                .get_index_pk()
                .iter()
                .collect::<Vec<_>>()
        )
        .unwrap(),
        before
    );
    let g = chain
        .open::<_, LoanTable>()
        .get_index_pk()
        .iter()
        .next()
        .unwrap();
    assert!(!g.active);
    assert_eq!(g.original_units, 214);
    assert_eq!(
        chain
            .open::<_, MarketTable>()
            .get_index_pk()
            .get(&f.market)
            .unwrap()
            .debt_quote,
        0
    );
    // Renewal changes only the empty active credit epoch, not old funded claims.
    Wrapper::push_from(&chain, account!("trader"))
        .renew(f.market)
        .get()?;
    audit(&chain);
    for user in [account!("alice"), account!("bob")] {
        Wrapper::push_from(&chain, user)
            .claim(f.market, true, 80)
            .get()?;
        audit(&chain);
    }
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn unsafe_liquidity_and_lender_withdrawals_rejected(chain: Chain) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let lp = Wrapper::push_from(&chain, account!("lp"));
    let lender = Wrapper::push_from(&chain, account!("lender"));
    let a = Wrapper::push_from(&chain, account!("alice"));
    let lend_shares = lender.lend(f.market, false, 100_000_000).get()?;
    a.borrow(f.market, true, 80, 5000).get()?;
    audit(&chain);
    rejects!(chain, a.renew(f.market));
    let supply = chain
        .open::<_, MarketTable>()
        .get_index_pk()
        .get(&f.market)
        .unwrap()
        .lp_supply;
    rejects!(chain, lp.remliq(f.market, supply * 9 / 10));
    rejects!(chain, lender.unlend(f.market, false, lend_shares));
    a.repay(f.market, true, 80, 5000).get()?;
    audit(&chain);
    a.renew(f.market).get()?;
    lp.remliq(f.market, supply * 9 / 10).get()?;
    lender.unlend(f.market, false, lend_shares).get()?;
    audit(&chain);
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn cascade_checkpoints_and_both_directions(chain: Chain) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let lender = Wrapper::push_from(&chain, account!("lender"));
    lender.lend(f.market, false, 100_000_000).get()?;
    lender.lend(f.market, true, 5_000_000).get()?;
    let a = Wrapper::push_from(&chain, account!("alice"));
    for p in [90, 89, 88, 87] {
        a.borrow(f.market, true, p, 300).get()?;
    }
    for p in [110, 111, 112, 113] {
        a.borrow(f.market, false, p, 300).get()?;
    }
    let trader = Wrapper::push_from(&chain, account!("trader"));
    let result = trader.trade(f.market, true, 60_000, 0, 1).get()?;
    assert_eq!(result.2, 1);
    audit(&chain);
    assert_eq!(trader.liquidate(f.market, 1).get()?, 1);
    audit(&chain);
    trader.liquidate(f.market, 16).get()?;
    audit(&chain);
    trader.trade(f.market, false, 100_000_000, 0, 64).get()?;
    audit(&chain);
    assert_eq!(
        chain
            .open::<_, MarketTable>()
            .get_index_pk()
            .get(&f.market)
            .unwrap()
            .debt_base,
        0
    );
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn mutable_token_admin_blocks_margin(chain: Chain) -> Result<(), Error> {
    let f = setup(&chain, false)?;
    rejects!(
        chain,
        Wrapper::push_from(&chain, account!("lender")).lend(f.market, false, 100_000_000)
    );
    rejects!(
        chain,
        Wrapper::push_from(&chain, account!("alice")).borrow(f.market, true, 80, 100)
    );
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn recipient_auto_debit_independent_and_read_only_snapshot(chain: Chain) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let user = account!("alice");
    Tokens::push_from(&chain, user)
        .setUserConf(BalanceFlags::AUTO_DEBIT.index(), false)
        .get()?;
    let result = Wrapper::push_from(&chain, user)
        .trade(f.market, true, 1000, 0, 16)
        .get()?;
    assert!(result.1 > 0);
    audit(&chain);
    let incoming = chain
        .open::<_, tokens::tables::tables::SharedBalanceTable>()
        .get_index_by_creditor_debitor_token()
        .get(&(crate::SERVICE, user, f.quote))
        .unwrap()
        .balance
        .value;
    assert!(incoming > 0);
    let before = state(&chain);
    let snapshot = Wrapper::push_from(&chain, user).snapshot(user).get()?;
    let value: Value = serde_json::from_str(&snapshot).unwrap();
    assert_eq!(value["owner"], "alice");
    assert!(value["balances"].as_array().unwrap().is_empty());
    assert!(value["tokens"].as_array().unwrap().is_empty());
    assert_eq!(state(&chain), before);
    Tokens::push_from(&chain, user)
        .debit(f.quote, crate::SERVICE, incoming.into(), "".into())
        .get()?;
    audit(&chain);
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn exactly_funded_marketable_limits_rest_without_second_debit(chain: Chain) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let bob = account!("bob");
    let budget = 10_000_000_u64;
    Tokens::push_from(&chain, bob)
        .uncredit(
            f.quote,
            crate::SERVICE,
            (1_000_000_000 - budget).into(),
            "".into(),
        )
        .get()?;
    let primary_quote = |user| {
        chain
            .open::<_, tokens::tables::tables::BalanceTable>()
            .get_index_pk()
            .get(&(user, f.quote))
            .map(|b| b.balance.value)
            .unwrap_or(0)
    };
    let primary_base = |user| {
        chain
            .open::<_, tokens::tables::tables::BalanceTable>()
            .get_index_pk()
            .get(&(user, f.base))
            .map(|b| b.balance.value)
            .unwrap_or(0)
    };
    let before = primary_quote(bob);
    let b = Wrapper::push_from(&chain, bob);
    b.limit(f.market, true, 110, budget).get()?;
    audit(&chain);
    let pos = chain
        .open::<_, MakerTable>()
        .get_index_pk()
        .get(&(bob, f.market, true, 110))
        .unwrap();
    let pool = chain
        .open::<_, PoolTable>()
        .get_index_pk()
        .get(&pos.generation)
        .unwrap();
    assert!(pool.outgoing > 0 && pool.outgoing < budget);
    assert_eq!(
        primary_quote(bob),
        before,
        "unspent committed input must directly fund the passive remainder"
    );
    let native_shared = chain
        .open::<_, tokens::tables::tables::SharedBalanceTable>()
        .get_index_by_creditor_debitor_token()
        .get(&(bob, crate::SERVICE, f.quote));
    assert_eq!(native_shared.map(|r| r.balance.value).unwrap_or(0), 0);
    let received = primary_base(bob);
    assert!(received > 0);
    let consumed = budget - pool.outgoing;
    assert!(
        received as u128 * 110 >= consumed as u128,
        "buy execution exceeded limit price"
    );
    b.cancel(f.market, true, 110).get()?;
    audit(&chain);
    let alice = account!("alice");
    let before_quote = primary_quote(alice);
    Wrapper::push_from(&chain, alice)
        .limit(f.market, false, 90, 10_000)
        .get()?;
    audit(&chain);
    assert!(
        primary_quote(alice) - before_quote >= 900_000,
        "sell execution fell below limit price"
    );
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn private_http_snapshot_rejects_unauthenticated_queries(chain: Chain) -> Result<(), Error> {
    setup(&chain, true)?;
    let request = HttpRequest {
        method: "GET".into(),
        target: "/snapshot?owner=bob".into(),
        ..Default::default()
    };
    rejects!(
        chain,
        exchange_pkg::r_exchange::Wrapper::push_from(&chain, account!("alice")).serveSys(
            request,
            None,
            Some(account!("bob"))
        )
    );
    assert_eq!(
        chain.get(crate::SERVICE, "/snapshot?owner=alice")?.status,
        403
    );
    let public = chain.get(crate::SERVICE, "/markets")?;
    assert_eq!(public.status, 200);
    let body: Value = serde_json::from_slice(&public.body.0).unwrap();
    assert!(body.get("balances").is_none() && body.get("positions").is_none());
    let catalog = chain.get(crate::SERVICE, "/tokens?after=0&limit=1")?;
    assert_eq!(catalog.status, 200);
    let body: Value = serde_json::from_slice(&catalog.body.0).unwrap();
    assert_eq!(body["tokens"].as_array().unwrap().len(), 1);
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn recent_trade_feed_is_native_paginated_and_excludes_rejected_actions(
    chain: Chain,
) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let trader = Wrapper::push_from(&chain, account!("trader"));
    let first = trader.trade(f.market, true, 1000, 0, 16).get()?;
    let second = trader.trade(f.market, false, 20000, 0, 16).get()?;
    for _ in 0..4 {
        chain.start_block();
    }
    let read = |path: &str| -> Result<Value, Error> {
        let response = chain.get(crate::SERVICE, path)?;
        assert_eq!(
            response.status,
            200,
            "{}",
            String::from_utf8_lossy(&response.body.0)
        );
        Ok(serde_json::from_slice(&response.body.0)?)
    };
    let newest = read(&format!("/trades?market={}&limit=1", f.market))?;
    assert_eq!(newest["source"], "native-history");
    assert_eq!(newest["trades"].as_array().unwrap().len(), 1);
    let trade = &newest["trades"][0];
    assert_eq!(trade["side"], "buy");
    assert_eq!(trade["base_amount"], second.1.to_string());
    assert_eq!(trade["quote_amount"], second.0.to_string());
    assert!(trade["time"].as_str().unwrap().ends_with('Z'));
    let cursor = newest["next_before"]
        .as_str()
        .expect("older real trade exists");
    let older = read(&format!(
        "/api/trades?market={}&limit=1&before={}",
        f.market, cursor
    ))?;
    assert_eq!(older["trades"][0]["side"], "sell");
    assert_eq!(older["trades"][0]["base_amount"], first.0.to_string());
    assert_eq!(older["trades"][0]["quote_amount"], first.1.to_string());
    assert_ne!(older["trades"][0]["event_id"], trade["event_id"]);
    let oldest_id = older["trades"][0]["event_id"].as_str().unwrap();
    let newest_id = trade["event_id"].as_str().unwrap();
    let delta = read(&format!(
        "/api/trades?market={}&limit=10&after={oldest_id}",
        f.market
    ))?;
    assert_eq!(delta["trades"].as_array().unwrap().len(), 1);
    assert_eq!(delta["trades"][0]["event_id"], newest_id);
    assert!(delta["next_before"].is_null());
    for range in [
        format!("after={newest_id}"),
        format!("after={oldest_id}&before={newest_id}"),
        format!("after={newest_id}&before={oldest_id}"),
        "after=18446744073709551615".into(),
    ] {
        let empty = read(&format!("/trades?market={}&limit=10&{range}", f.market))?;
        assert!(empty["trades"].as_array().unwrap().is_empty());
    }
    rejects!(chain, trader.trade(f.market, true, 1000, 1_000_000_000, 16));
    let after = read(&format!("/trades?market={}&limit=1", f.market))?;
    assert_eq!(after["trades"][0]["event_id"], trade["event_id"]);
    let delta = read(&format!("/trades?market={}&after={newest_id}", f.market))?;
    assert!(delta["trades"].as_array().unwrap().is_empty());
    let empty = read("/trades?market=18446744073709551615&limit=10")?;
    assert!(empty["trades"].as_array().unwrap().is_empty());
    assert_eq!(
        chain
            .get(crate::SERVICE, "/trades?market=1&limit=101")?
            .status,
        400
    );
    assert_eq!(
        chain
            .get(crate::SERVICE, "/api/state?account=alice")?
            .status,
        403
    );
    for invalid in ["-1", "18446744073709551616", "1%20OR%201", ""] {
        assert_eq!(
            chain
                .get(crate::SERVICE, &format!("/trades?market=1&after={invalid}"))?
                .status,
            400
        );
    }
    // Public price levels carry depth only. A private snapshot can reference
    // a lending cohort only when this authenticated owner has a position in it.
    Wrapper::push_from(&chain, account!("alice"))
        .limit(f.market, true, 90, 90_000)
        .get()?;
    Wrapper::push_from(&chain, account!("bob"))
        .limit(f.market, false, 110, 1000)
        .get()?;
    Wrapper::push_from(&chain, account!("lender"))
        .lend(f.market, false, 100_000_000)
        .get()?;
    Wrapper::push_from(&chain, account!("alice"))
        .borrow(f.market, true, 80, 100)
        .get()?;
    Wrapper::push_from(&chain, account!("bob"))
        .borrow(f.market, true, 80, 200)
        .get()?;
    let public = read("/api/markets")?;
    assert!(public["levels"].as_array().unwrap().is_empty());
    let depth = read(&format!("/book?market={}&bid=true", f.market))?;
    let fields = ["market", "bid", "price", "outgoing", "active"];
    assert!(!depth["levels"].as_array().unwrap().is_empty());
    for level in depth["levels"].as_array().unwrap() {
        let level = level.as_object().unwrap();
        assert_eq!(level.len(), fields.len());
        assert!(fields.iter().all(|field| level.contains_key(*field)));
    }
    for field in [
        "positions",
        "loans",
        "loan_positions",
        "balances",
        "lenders",
        "relay_shares",
    ] {
        assert!(public.get(field).is_none());
    }
    for owner in [account!("alice"), account!("bob"), account!("trader")] {
        let own: Value =
            serde_json::from_str(&Wrapper::push_from(&chain, owner).snapshot(owner).get()?)?;
        let loan_positions = own["loan_positions"].as_array().unwrap();
        assert!(loan_positions
            .iter()
            .all(|p| p["owner"] == owner.to_string()));
        assert!(own["loans"]
            .as_array()
            .unwrap()
            .iter()
            .all(|loan| loan_positions
                .iter()
                .any(|p| p["generation"] == loan["generation"])));
        assert!(own["positions"]
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p["owner"] == owner.to_string()));
        if owner == account!("trader") {
            assert!(own["loans"].as_array().unwrap().is_empty());
        } else {
            assert_eq!(loan_positions.len(), 1);
            assert_eq!(own["loans"].as_array().unwrap().len(), 1);
            let expected_units = if owner == account!("alice") { 100 } else { 200 };
            assert_eq!(own["loans"][0]["scope"], "own-position");
            assert_eq!(own["loans"][0]["units"], expected_units);
            assert_eq!(own["loans"][0]["original_units"], expected_units);
            assert_eq!(own["loans"][0]["claimable_surplus"], 0);
        }
    }
    audit(&chain);
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn independent_books_same_assets_cannot_capture_each_other(chain: Chain) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let first = serde_json::to_value(
        chain
            .open::<_, MarketTable>()
            .get_index_pk()
            .get(&f.market)
            .unwrap(),
    )
    .unwrap();
    let other = Wrapper::push_from(&chain, account!("alice"))
        .create(f.base, f.quote, 2_000_000, 200_000_000, 1000, 100)
        .get()?;
    assert_ne!(other, f.market);
    audit(&chain);
    Wrapper::push_from(&chain, account!("bob"))
        .limit(other, true, 900, 900_000)
        .get()?;
    Wrapper::push_from(&chain, account!("lender"))
        .lend(other, false, 100_000_000)
        .get()?;
    Wrapper::push_from(&chain, account!("alice"))
        .borrow(other, true, 900, 10)
        .get()?;
    audit(&chain);
    Wrapper::push_from(&chain, account!("trader"))
        .trade(other, true, 200_000, 0, 64)
        .get()?;
    audit(&chain);
    assert_eq!(
        serde_json::to_value(
            chain
                .open::<_, MarketTable>()
                .get_index_pk()
                .get(&f.market)
                .unwrap()
        )
        .unwrap(),
        first
    );
    assert_eq!(
        chain
            .open::<_, BookTable>()
            .get_index_pk()
            .range((f.market, false, 0)..=(f.market, true, u64::MAX))
            .count(),
        0
    );
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn recalled_old_spot_book_cannot_drain_new_guaranteed_market(chain: Chain) -> Result<(), Error> {
    let f = setup_tokens(&chain, false, false)?;
    let issuer = account!("issuer");
    let t = Tokens::push_from(&chain, issuer);
    assert_eq!(
        chain
            .open::<_, MarketTable>()
            .get_index_pk()
            .get(&f.market)
            .unwrap()
            .margin_enabled,
        Some(false)
    );
    t.recall(
        f.quote,
        crate::SERVICE,
        100_000_000_u64.into(),
        "issuer recall".into(),
        Some(format!("market-{}", f.market)),
    )
    .get()?;
    let deficits = [(f.market, f.quote, 100_000_000)];
    audit_with_deficits(&chain, &deficits);
    // Sealing these token contracts cannot retrospectively certify old books.
    for token in [f.base, f.quote] {
        t.setTokenConf(token, 1, true).get()?;
        let admin = t.getToken(token).get()?.nft_id;
        Nft::push_from(&chain, issuer).burn(admin).get()?;
    }
    let lender = Wrapper::push_from(&chain, account!("lender"));
    let before = state(&chain);
    assert!(lender
        .lend(f.market, false, 1_000_000)
        .trace
        .error
        .is_some());
    assert_eq!(
        state(&chain),
        before,
        "old mutable book must stay margin-ineligible"
    );
    let fresh = Wrapper::push_from(&chain, account!("alice"))
        .create(f.base, f.quote, 1_000_000, 100_000_000, 100, 100)
        .get()?;
    assert_eq!(
        chain
            .open::<_, MarketTable>()
            .get_index_pk()
            .get(&fresh)
            .unwrap()
            .margin_enabled,
        Some(true)
    );
    lender.lend(fresh, false, 100_000_000).get()?;
    Wrapper::push_from(&chain, account!("alice"))
        .borrow(fresh, true, 80, 100)
        .get()?;
    audit_with_deficits(&chain, &deficits);
    let safe_record = serde_json::to_value(
        chain
            .open::<_, MarketTable>()
            .get_index_pk()
            .get(&fresh)
            .unwrap(),
    )
    .unwrap();
    let safe_base = native_market_balance(&chain, fresh, f.base);
    let safe_quote = native_market_balance(&chain, fresh, f.quote);
    let owned = chain
        .open::<_, LiquidityTable>()
        .get_index_pk()
        .get(&(account!("lp"), f.market))
        .unwrap()
        .shares;
    let before = state(&chain);
    assert!(Wrapper::push_from(&chain, account!("lp"))
        .remliq(f.market, owned)
        .trace
        .error
        .is_some());
    assert_eq!(
        state(&chain),
        before,
        "failed old phantom withdrawal must roll back all markets/native rows"
    );
    assert_eq!(native_market_balance(&chain, fresh, f.base), safe_base);
    assert_eq!(native_market_balance(&chain, fresh, f.quote), safe_quote);
    assert_eq!(
        serde_json::to_value(
            chain
                .open::<_, MarketTable>()
                .get_index_pk()
                .get(&fresh)
                .unwrap()
        )
        .unwrap(),
        safe_record
    );
    // Even new spot funding cannot recapitalize an underfunded historical row
    // silently; both native assets are checked before moving incoming tokens.
    let before = state(&chain);
    assert!(Wrapper::push_from(&chain, account!("bob"))
        .trade(f.market, false, 1000, 0, 16)
        .trace
        .error
        .is_some());
    assert_eq!(state(&chain), before);
    let before = state(&chain);
    assert!(Wrapper::push_from(&chain, account!("bob"))
        .limit(f.market, false, 110, 1000)
        .trace
        .error
        .is_some());
    assert_eq!(
        state(&chain),
        before,
        "even unaffected-asset passive funding must pause an insolvent old book"
    );
    Wrapper::push_from(&chain, account!("trader"))
        .trade(fresh, true, 500_000, 0, 64)
        .get()?;
    audit_with_deficits(&chain, &deficits);
    assert_eq!(
        chain
            .open::<_, MarketTable>()
            .get_index_pk()
            .get(&fresh)
            .unwrap()
            .debt_quote,
        0
    );
    Ok(())
}

#[path = "test_metrics.rs"]
mod metrics;
#[path = "stop_benchmark_tests.rs"]
mod stop_benchmark_tests;
#[path = "stop_security_tests.rs"]
mod stop_security_tests;

#[path = "stop_api_tests.rs"]
mod stop_api_tests;

#[path = "review_reproduction_tests.rs"]
mod review_reproduction_tests;

#[path = "native_wallet_cors_tests.rs"]
mod native_wallet_cors_tests;

#[path = "candle_native_tests.rs"]
mod candle_native_tests;

#[cfg(test)]
#[path = "pagination_native_tests.rs"]
mod pagination_native_tests;
