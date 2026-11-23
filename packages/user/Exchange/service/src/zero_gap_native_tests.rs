//! Exact live integer-boundary regression with real native custody and rollback.
use super::*;
use psibase::fracpack::Pack as _;

fn zero_gap_fixture(chain: &mut Chain, sell: bool) -> Result<Fixture, Error> {
    let issuer = account!("issuer");
    for owner in [issuer, account!("lp"), account!("alice"), account!("bob")] {
        chain.new_account(owner)?;
        Tokens::push_from(chain, owner)
            .setUserConf(BalanceFlags::AUTO_DEBIT.index(), true)
            .get()?;
    }
    let issue = || -> Result<u32, Error> {
        let tokens = Tokens::push_from(chain, issuer);
        let id = tokens
            .create(4.try_into().unwrap(), 1_000_000_000_000_u64.into())
            .get()?;
        let nft = tokens.getToken(id).get()?.nft_id;
        Nft::push_from(chain, issuer).debit(nft, "".into()).get()?;
        tokens
            .mint(id, 1_000_000_000_000_u64.into(), "".into())
            .get()?;
        tokens.setTokenConf(id, 1, true).get()?;
        Nft::push_from(chain, issuer).burn(nft).get()?;
        for (owner, quantity) in [
            (account!("lp"), 500_000_000_000_u64),
            (account!("alice"), 100_000_000),
            (account!("bob"), 100_000_000),
        ] {
            tokens.credit(id, owner, quantity.into(), "".into()).get()?;
            Tokens::push_from(chain, owner)
                .credit(id, crate::SERVICE, quantity.into(), "".into())
                .get()?;
        }
        Ok(id)
    };
    let base = issue()?;
    let quote = issue()?;
    let (x, y, lot, tick, price) = if sell {
        (77_781_745_931, 12_856_486_932, 60_500, 10_000, 1)
    } else {
        (12_856_486_932, 77_781_745_931, 10_000, 1, 60_500)
    };
    let market = Wrapper::push_from(chain, account!("lp"))
        .create(base, quote, x, y, lot, tick)
        .get()?;
    chain.finish_block();
    let table = chain.open::<_, MarketTable>();
    let mut m = table.get_index_pk().get(&market).unwrap();
    // Import the valid protected-product slack of the actual live state. Every
    // physical reserve came through native Tokens; no custody row is fabricated.
    m.k = 1_000_000_000_110_001_900_002_u128.into();
    assert!(m.k.get() <= m.x as u128 * m.y as u128);
    let mut key = table.get_index_pk().prefix;
    market.append_key(&mut key);
    chain.kv_put_bytes(DbId::Service, &key, &m.packed());
    Wrapper::push_from(chain, account!("bob"))
        .limit(market, sell, price, 100_000)
        .get()?;
    audit(chain);
    Ok(Fixture {
        market,
        base,
        quote,
    })
}

fn market_row(chain: &Chain, market: u64) -> Market {
    chain
        .open::<_, MarketTable>()
        .get_index_pk()
        .get(&market)
        .unwrap()
}

fn free_owner_total(chain: &Chain, owner: AccountNumber, token: u32) -> u64 {
    let wallet = chain.open::<_, tokens::tables::tables::BalanceTable>()
        .get_index_pk().get(&(owner, token)).map(|r| r.balance.value).unwrap_or(0);
    wallet + chain.open::<_, tokens::tables::tables::SharedBalanceTable>()
        .get_index_pk().iter().filter(|r| r.token_id == token &&
            ((r.creditor == owner && r.debitor == crate::SERVICE) ||
             (r.creditor == crate::SERVICE && r.debitor == owner)))
        .map(|r| r.balance.value).sum::<u64>()
}

#[psibase::test_case(packages("Exchange"))]
fn native_zero_output_gap_fills_head_market_and_limit_and_preserves_custody(
    mut chain: Chain,
) -> Result<(), Error> {
    for sell in [false, true] {
        let f = zero_gap_fixture(&mut chain, sell)?;
        let price = if sell { 1 } else { 60_500 };
        for armed in [false, true] {
            let base = chain.fork();
            if armed {
                Wrapper::push_from(&base, account!("bob"))
                    .stop(f.market, !sell, if sell { 2 } else { 30_250 }, 20_000)
                    .get()?;
            }
            let before = market_row(&base, f.market);
            let u = if sell { before.x } else { before.y };
            let v = if sell { before.y } else { before.x };
            let h = crate::math::book_trigger(
                before.k.get(),
                sell,
                price,
                before.base_lot,
                before.quote_tick,
            );
            assert_eq!(h - u, 3);
            assert_eq!(crate::math::relay(before.k.get(), u, v, h - u).2, 0);
            let rejected = base.fork();
            rejects!(
                rejected,
                Wrapper::push_from(&rejected, account!("alice"))
                    .trade(f.market, sell, 60_500, 10_001, 1)
            );
            for limit in [false, true] {
                let c = base.fork();
                let trader = Wrapper::push_from(&c, account!("alice"));
                if limit {
                    assert_eq!(trader.limit(f.market, !sell, price, 60_500).get()?, 0);
                } else {
                    let result = trader.trade(f.market, sell, 60_500, 10_000, 1).get()?;
                    assert_eq!((result.0, result.1), (60_500, 10_000));
                }
                let after = market_row(&c, f.market);
                assert_eq!(
                    (after.x, after.y, after.k.get()),
                    (before.x, before.y, before.k.get())
                );
                let pool = c
                    .open::<_, PoolTable>()
                    .get_index_pk()
                    .iter()
                    .find(|p| p.market == f.market)
                    .unwrap();
                assert_eq!((pool.incoming, pool.outgoing), (60_500, 90_000));
                assert!(c
                    .open::<_, MakerTable>()
                    .get_index_pk()
                    .get(&(account!("alice"), f.market, !sell, price))
                    .is_none());
                audit(&c);
            }
            if armed {
                let partial = base.fork();
                let result = Wrapper::push_from(&partial, account!("alice"))
                    .trade(f.market, sell, 60_499, 0, 1)
                    .get()?;
                assert_eq!((result.0, result.1), (0, 0));
                for token in [f.base, f.quote] {
                    assert_eq!(free_owner_total(&partial, account!("alice"), token),
                               free_owner_total(&base, account!("alice"), token), "sublot input was donated");
                    assert_eq!(native_market_balance(&partial, f.market, token),
                               native_market_balance(&base, f.market, token));
                }
                audit(&partial);
            }
        }
    }
    Ok(())
}
