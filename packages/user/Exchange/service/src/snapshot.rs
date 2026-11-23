//! Read-only native tables. No token action getters, no ID allocation in RPC.
use crate::tables::tables::*;
use psibase::{AccountNumber, KvHandle, KvMode, Table, TableRecord};
use serde_json::{json, Value};
// Used only by the authenticated READ-ONLY query service, never the financial
// action snapshot. Db.open intentionally forbids arbitrary foreign prefixes.
pub(crate) fn foreign<R: TableRecord, T: Table<R>>(service: AccountNumber) -> T {
    let prefix = psio::to_key(&(service, T::TABLE_INDEX));
    T::from_handle(KvHandle::open_direct(R::DB, &prefix, KvMode::Read))
}
const MAX_JS_INTEGER: u128 = (1_u128 << 53) - 1;
pub(crate) fn integer(value: u128) -> Value {
    if value <= MAX_JS_INTEGER {
        json!(value as u64)
    } else {
        Value::String(value.to_string())
    }
}
pub(crate) fn preserve_integers(value: &mut Value) {
    match value {
        Value::Array(items) => {
            for item in items {
                preserve_integers(item)
            }
        }
        Value::Object(object) => {
            for item in object.values_mut() {
                preserve_integers(item)
            }
        }
        Value::Number(number) => {
            if let Some(n) = number.as_u64() {
                if n as u128 > MAX_JS_INTEGER {
                    *value = Value::String(n.to_string())
                }
            }
        }
        _ => {}
    }
}

pub(crate) fn order_view(position: &Maker, generation: &Pool, market: &Market) -> Value {
    let remaining =
        position.shares as u128 * generation.outgoing as u128 / generation.shares as u128;
    let proceeds =
        (position.shares as u128 * generation.index.get() - position.debt.get()) / crate::math::Q;
    let quote_per_lot = position.price as u128 * market.quote_tick as u128;
    let (base, quote) = if position.bid {
        (
            remaining * market.base_lot as u128 / quote_per_lot,
            remaining,
        )
    } else {
        (
            remaining,
            remaining * quote_per_lot / market.base_lot as u128,
        )
    };
    json!({"owner":position.owner,"market":position.market,"bid":position.bid,
        "side":if position.bid{"buy"}else{"sell"},"price":position.price,
        "generation":position.generation,"shares":position.shares,"debt":position.debt.to_string(),
        "refund":integer(remaining),"proceeds":integer(proceeds),"active":generation.active,
        "remaining_outgoing":integer(remaining),"remaining_base":integer(base),
        "remaining_quote":integer(quote),"claimable_incoming":integer(proceeds),
        "status":if generation.active{"open"}else if generation.outgoing==0{"filled"}else{"remainder"}})
}

fn stop_view(position: &StopPosition, pool: &StopPool, batch: Option<&StopBatch>) -> Value {
    let (remaining, refund, output, status) = if let Some(batch) = batch {
        assert!(batch.input_total > 0, "stop batch denominator");
        let refund =
            position.shares as u128 * batch.refund_total as u128 / batch.input_total as u128;
        let output =
            position.shares as u128 * batch.output_total as u128 / batch.input_total as u128;
        (
            0,
            refund,
            output,
            if refund == 0 {
                "filled"
            } else if output == 0 {
                "unfilled"
            } else {
                "partially_filled"
            },
        )
    } else {
        (position.shares as u128, 0, 0, "armed")
    };
    json!({"owner":position.owner,"generation":position.generation,
        "market":pool.market,"sell_base":pool.sell_base,"trigger":pool.trigger,
        "status":status,"remaining_outgoing":integer(remaining),
        "claimable_input":integer(refund),"claimable_output":integer(output),
        "original_input":integer(position.shares as u128)})
}
/// A private position view, not a serialized shared Loan row. Legacy ratio
/// fields below describe this owner's units and exact rounded entitlement so
/// existing wallet claim construction never needs another borrower's totals.
pub(crate) fn loan_view(position: &Borrower, generation: &Loan) -> Value {
    let claim = if generation.active {
        0
    } else {
        assert!(generation.original_units > 0, "closed loan units");
        position.units as u128 * generation.original_surplus as u128
            / generation.original_units as u128
    };
    json!({"scope":"own-position","generation":position.generation,
        "market":position.market,"long":position.long,"price":position.price,
        "units":position.units,"collateral_unit":generation.collateral_unit,
        "face_unit":generation.face_unit,"active":generation.active,
        "claimable_surplus":integer(claim),"original_units":position.units,
        "original_surplus":integer(claim),"surplus":integer(claim)})
}
pub(crate) fn stored_stop_view(position: &StopPosition) -> Value {
    let pool = StopPoolTable::with_service(crate::SERVICE)
        .get_index_pk()
        .get(&position.generation)
        .expect("stop position generation");
    let batch = pool.batch.map(|id| {
        StopBatchTable::with_service(crate::SERVICE)
            .get_index_pk()
            .get(&id)
            .expect("stop batch")
    });
    let market = MarketTable::with_service(crate::SERVICE)
        .get_index_pk()
        .get(&pool.market)
        .expect("stop market");
    let mut value = stop_view(position, &pool, batch.as_ref());
    value["input_token"] = json!(if pool.sell_base {
        market.base
    } else {
        market.quote
    });
    value["output_token"] = json!(if pool.sell_base {
        market.quote
    } else {
        market.base
    });
    value
}
pub(crate) fn stop_page(
    owner: AccountNumber,
    before: Option<u64>,
    limit: usize,
) -> (Vec<Value>, Option<u64>) {
    use std::ops::Bound::{Excluded, Included};
    let table = StopPositionTable::with_service(crate::SERVICE);
    let index = table.get_index_pk();
    let upper = before
        .map(|id| Excluded((owner, id)))
        .unwrap_or(Included((owner, u64::MAX)));
    let mut rows: Vec<_> = index
        .range((Included((owner, 0)), upper))
        .rev()
        .take(limit + 1)
        .collect();
    let more = rows.len() > limit;
    rows.truncate(limit);
    let next = if more {
        rows.last().map(|row| row.generation)
    } else {
        None
    };
    let values = rows.iter().map(stored_stop_view).collect();
    (values, next)
}
/// Only an authenticated handler supplies the owner; cursors never choose it.
pub fn read_stops(owner: AccountNumber, before: Option<u64>, limit: u32) -> String {
    assert!((1..=200).contains(&limit), "stop position page size");
    let (positions, next) = stop_page(owner, before, limit as usize);
    let (markets, tokens) = crate::pages::related(
        positions.iter().map(|p| p["market"].as_u64().unwrap()),
        true,
    )
    .expect("stop metadata");
    let mut page = json!({"owner":owner,"stop_positions":positions,"next_before":next,"markets":markets,"tokens":tokens});
    preserve_integers(&mut page);
    page.to_string()
}
pub fn read_stop(owner: AccountNumber, generation: u64) -> String {
    let position = StopPositionTable::with_service(crate::SERVICE)
        .get_index_pk()
        .get(&(owner, generation));
    let view = position.as_ref().map(|position| {
        let mut view = stored_stop_view(position);
        let defaults = foreign::<_, tokens::tables::tables::UserConfigTable>(tokens::SERVICE)
            .get_index_pk()
            .get(&owner)
            .map(|row| row.flags)
            .unwrap_or(0);
        for (token_key, flag_key) in [
            ("input_token", "input_auto_debit"),
            ("output_token", "output_auto_debit"),
        ] {
            let token = view[token_key].as_u64().unwrap() as u32;
            let flags = foreign::<_, tokens::tables::tables::BalanceConfigTable>(tokens::SERVICE)
                .get_index_pk()
                .get(&(owner, token))
                .map(|row| row.flags)
                .unwrap_or(defaults);
            view[flag_key] = json!(flags & 1 != 0);
        }
        view
    });
    let (markets, tokens) =
        crate::pages::related(view.iter().map(|r| r["market"].as_u64().unwrap()), true)
            .expect("stop metadata");
    let mut value = json!({"owner":owner,"stop_position":view,"markets":markets,"tokens":tokens});
    preserve_integers(&mut value);
    value.to_string()
}
pub(crate) fn metadata(t: &tokens::tables::tables::Token) -> Value {
    let sym = foreign::<_, symbol::tables::MappingTable>(symbol::SERVICE)
        .get_index_pk()
        .get(&t.id)
        .map(|m| m.symbolId.to_string());
    json!({"id":t.id,"precision":t.precision.value(),"symbol":sym,"settings":t.settings_value})
}
pub(crate) fn escrow_view(market: u64, token: u32, include_native: bool) -> Value {
    use tokens::tables::tables::{SubAccountBalanceTable, SubAccountTable};
    let expected = EscrowTable::with_service(crate::SERVICE)
        .get_index_pk()
        .get(&(market, token))
        .map(|e| e.balance)
        .unwrap_or(0);
    if !include_native {
        return json!({"expected":integer(expected as u128),"actual":null,"funded":null});
    }
    let sub = foreign::<_, SubAccountTable>(tokens::SERVICE)
        .get_index_pk()
        .get(&(crate::SERVICE, format!("market-{market}")));
    let actual = sub
        .and_then(|s| {
            foreign::<_, SubAccountBalanceTable>(tokens::SERVICE)
                .get_index_pk()
                .get(&(s.id, token))
        })
        .map(|b| b.balance.value)
        .unwrap_or(0);
    json!({"expected":integer(expected as u128),"actual":integer(actual as u128),"funded":expected==actual})
}
pub fn token_catalog(after: u32, limit: u32) -> String {
    use std::ops::Bound::{Excluded, Unbounded};
    let limit = limit.clamp(1, 200) as usize;
    let mut rows: Vec<_> = foreign::<_, tokens::tables::tables::TokenTable>(tokens::SERVICE)
        .get_index_pk()
        .range((Excluded(after), Unbounded))
        .take(limit + 1)
        .collect();
    let next = if rows.len() > limit {
        rows.pop();
        rows.last().map(|t| t.id)
    } else {
        None
    };
    let tokens: Vec<_> = rows.iter().map(metadata).collect();
    json!({"tokens":tokens,"next":next}).to_string()
}
pub fn read_public() -> String {
    let mut page = crate::pages::markets(0, 200, true).expect("market discovery");
    if let Some(id) = page["markets"]
        .as_array()
        .unwrap()
        .first()
        .and_then(|m| m["id"].as_u64())
    {
        let bid = crate::pages::book(id, true, None, 200).unwrap();
        let ask = crate::pages::book(id, false, None, 200).unwrap();
        page["levels"] = json!([
            bid["levels"].as_array().unwrap().as_slice(),
            ask["levels"].as_array().unwrap().as_slice()
        ]
        .concat());
        page["levels_market"] = json!(id);
        page["book_continuations"] = json!({"bid":bid["next_after"],"ask":ask["next_after"]});
    }
    crate::pages::text(page)
}
pub fn read(owner: AccountNumber) -> String {
    crate::pages::text(crate::pages::snapshot(owner, None, true).expect("bounded snapshot"))
}
/// Financial actions cannot open native foreign prefixes.
pub fn read_exchange(owner: AccountNumber) -> String {
    crate::pages::text(
        crate::pages::snapshot(owner, None, false).expect("bounded exchange snapshot"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stop_views_expose_exact_own_claims_without_other_owners_totals() {
        let position = StopPosition {
            owner: psibase::account!("alice"),
            generation: 8,
            shares: 3,
        };
        let pool = StopPool {
            id: 8,
            market: 1,
            sell_base: true,
            trigger: 90,
            input: 7,
            shares: 7,
            batch: None,
        };
        let armed = stop_view(&position, &pool, None);
        assert_eq!(armed["remaining_outgoing"], 3);
        assert_eq!(armed["claimable_output"], 0);
        let batch = StopBatch {
            id: 9,
            market: 1,
            sell_base: true,
            input_total: 7,
            input_used: 3,
            output_total: 10,
            refund_total: 4,
            refund_remaining: 4,
            output_remaining: 10,
            shares_remaining: 7,
            margin_first: true,
            work_steps: 5,
        };
        let closed = stop_view(&position, &pool, Some(&batch));
        assert_eq!(closed["remaining_outgoing"], 0);
        assert_eq!(closed["claimable_input"], 1);
        assert_eq!(closed["claimable_output"], 4);
        assert_eq!(closed["original_input"], 3);
        assert!(closed.get("input_total").is_none() && closed.get("shares_remaining").is_none());
        assert!(closed.get("refund_total").is_none() && closed.get("work_steps").is_none());
    }
    #[test]
    fn loan_views_expose_only_own_units_and_exact_rounded_claim() {
        let position = Borrower {
            owner: psibase::account!("alice"),
            market: 1,
            long: true,
            price: 80,
            generation: 7,
            units: 3,
        };
        let generation = Loan {
            generation: 7,
            market: 1,
            long: true,
            price: 80,
            units: 7,
            collateral_unit: 100,
            face_unit: 80,
            active: true,
            original_units: 0,
            original_surplus: 0,
            surplus: 0,
        };
        let active = loan_view(&position, &generation);
        assert_eq!(active["units"], 3);
        assert_eq!(active["original_units"], 3);
        assert_eq!(active["claimable_surplus"], 0);
        let closed = loan_view(
            &position,
            &Loan {
                active: false,
                original_units: 7,
                original_surplus: 10,
                surplus: 10,
                ..generation
            },
        );
        assert_eq!(closed["claimable_surplus"], 4);
        assert_eq!(closed["original_surplus"], 4);
        assert_eq!(closed["surplus"], 4);
        assert_eq!(closed["original_units"], 3);
        assert_eq!(
            3 * closed["original_surplus"].as_u64().unwrap()
                / closed["original_units"].as_u64().unwrap(),
            4
        );
    }
    #[test]
    fn wide_native_quantities_stay_exact() {
        let mut value = json!({"large":u64::MAX,"small":42,"nested":[u64::MAX]});
        preserve_integers(&mut value);
        assert_eq!(value["large"], u64::MAX.to_string());
        assert_eq!(value["small"], 42);
        assert_eq!(value["nested"][0], u64::MAX.to_string());
        assert_eq!(
            integer(2 * u64::MAX as u128),
            (2 * u64::MAX as u128).to_string()
        );
    }
    #[test]
    fn open_orders_expose_remaining_assets_and_proceeds_without_fabricated_fills() {
        let market = Market {
            id: 1,
            base: 1,
            quote: 2,
            base_lot: 100,
            quote_tick: 100,
            x: 1_000_000,
            y: 100_000_000,
            k: 100_000_000_000_000_u128.into(),
            lp_supply: 10_000_000,
            vault_base: 0,
            vault_quote: 0,
            debt_base: 0,
            debt_quote: 0,
            lending_base: 0,
            lending_quote: 0,
            maturity: 1,
            margin_enabled: Some(true),
        };
        let mut generation = Pool {
            id: 2,
            market: 1,
            bid: true,
            price: 90,
            outgoing: 90_000,
            incoming: 3000,
            shares: 1000,
            index: (crate::math::Q * 5).into(),
            dust: 0_u128.into(),
            active: true,
        };
        let position = Maker {
            owner: psibase::account!("alice"),
            market: 1,
            bid: true,
            price: 90,
            generation: 2,
            shares: 100,
            debt: (crate::math::Q * 200).into(),
        };
        let view = order_view(&position, &generation, &market);
        assert_eq!(view["remaining_outgoing"], 9000);
        assert_eq!(view["remaining_base"], 100);
        assert_eq!(view["remaining_quote"], 9000);
        assert_eq!(view["claimable_incoming"], 300);
        assert_eq!(view["status"], "open");
        assert!(view.get("original").is_none() && view.get("filled").is_none());
        generation.active = false;
        generation.outgoing = 100;
        assert_eq!(
            order_view(&position, &generation, &market)["status"],
            "remainder"
        );
        generation.outgoing = 0;
        assert_eq!(
            order_view(&position, &generation, &market)["status"],
            "filled"
        );
    }
}
