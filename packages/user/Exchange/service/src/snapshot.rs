//! Read-only native tables. No token action getters, no ID allocation in RPC.
use crate::tables::tables::*;
use psibase::{AccountNumber, KvHandle, KvMode, Table, TableRecord, ToKey};
use serde_json::{json, Value};
// Used only by the authenticated READ-ONLY query service, never the financial
// action snapshot. Db.open intentionally forbids arbitrary foreign prefixes.
fn foreign<R: TableRecord, T: Table<R>>(service: AccountNumber) -> T {
    let prefix = (service, T::TABLE_INDEX).to_key();
    T::from_handle(KvHandle::open_direct(R::DB, &prefix, KvMode::Read))
}
const MAX_JS_INTEGER: u128 = (1_u128 << 53) - 1;
fn integer(value: u128) -> Value {
    if value <= MAX_JS_INTEGER {
        json!(value as u64)
    } else {
        Value::String(value.to_string())
    }
}
fn preserve_integers(value: &mut Value) {
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
fn metadata(t: &tokens::tables::tables::Token) -> Value {
    let sym = foreign::<_, symbol::tables::MappingTable>(symbol::SERVICE)
        .get_index_pk()
        .get(&t.id)
        .map(|m| m.symbolId.to_string());
    json!({"id":t.id,"precision":t.precision.value(),"symbol":sym,"settings":t.settings_value})
}
fn escrow_view(market: u64, token: u32, include_native: bool) -> Value {
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
    let value: Value = serde_json::from_str(&read(AccountNumber::default())).unwrap();
    json!({"markets":value["markets"],"levels":value["levels"],"tokens":value["tokens"]})
        .to_string()
}
pub fn read(owner: AccountNumber) -> String {
    build(owner, true)
}
/// Safe for the unprivileged financial action: no foreign-prefix access.
pub fn read_exchange(owner: AccountNumber) -> String {
    build(owner, false)
}
fn build(owner: AccountNumber, include_native: bool) -> String {
    let service = crate::SERVICE;
    let markets: Vec<_> = MarketTable::with_service(service)
        .get_index_pk()
        .iter()
        .take(100)
        .collect();
    let levels:Vec<_>=BookTable::with_service(service).get_index_pk().iter().take(1000).filter_map(|r|PoolTable::with_service(service).get_index_pk().get(&r.generation)).map(|p|json!({"id":p.id,"market":p.market,"bid":p.bid,"price":p.price,"outgoing":p.outgoing,"incoming":p.incoming,"shares":p.shares,"index":p.index.to_string(),"active":p.active})).collect();
    let positions:Vec<_>=MakerTable::with_service(service).get_index_pk().range((owner,0,false,0)..=(owner,u64::MAX,true,u64::MAX)).take(1000).map(|p|{let g=PoolTable::with_service(service).get_index_pk().get(&p.generation).unwrap();json!({"owner":p.owner,"market":p.market,"bid":p.bid,"price":p.price,"generation":p.generation,"shares":p.shares,"debt":p.debt.to_string(),"refund":p.shares as u128*g.outgoing as u128/g.shares as u128,"proceeds":((p.shares as u128*g.index.get()-p.debt.get())/crate::math::Q) as u64,"active":g.active})}).collect();
    let loan_positions: Vec<_> = BorrowerTable::with_service(service)
        .get_index_pk()
        .range((owner, 0, false, 0)..=(owner, u64::MAX, true, u64::MAX))
        .take(1000)
        .collect();
    let mut gids = std::collections::BTreeSet::new();
    for b in LoanBookTable::with_service(service)
        .get_index_pk()
        .iter()
        .take(1000)
    {
        gids.insert(b.generation);
    }
    for p in &loan_positions {
        gids.insert(p.generation);
    }
    let loans: Vec<_> = gids
        .iter()
        .filter_map(|id| LoanTable::with_service(service).get_index_pk().get(id))
        .collect();
    let lenders: Vec<_> = LenderTable::with_service(service)
        .get_index_pk()
        .range((owner, 0, false)..=(owner, u64::MAX, true))
        .take(1000)
        .collect();
    let relay_shares: Vec<_> = LiquidityTable::with_service(service)
        .get_index_pk()
        .range((owner, 0)..=(owner, u64::MAX))
        .take(1000)
        .collect();
    let mut tids = std::collections::BTreeSet::new();
    for m in &markets {
        tids.insert(m.base);
        tids.insert(m.quote);
    }
    let mut token_data = vec![];
    let mut balances = vec![];
    if include_native {
        for t in foreign::<_, tokens::tables::tables::TokenTable>(tokens::SERVICE)
            .get_index_pk()
            .iter()
            .take(1000)
        {
            tids.insert(t.id);
        }
        for row in foreign::<_, tokens::tables::tables::BalanceTable>(tokens::SERVICE)
            .get_index_pk()
            .range((owner, 0)..=(owner, u32::MAX))
            .take(1000)
        {
            tids.insert(row.token_id);
        }
        for row in foreign::<_, tokens::tables::tables::UserPendingTable>(tokens::SERVICE)
            .get_index_pk()
            .range((owner, 0, 0)..=(owner, u32::MAX, u64::MAX))
            .take(1000)
        {
            tids.insert(row.token_id);
        }
        for token in tids {
            use tokens::tables::tables::{
                BalanceConfigTable, BalanceTable, SharedBalanceTable, TokenTable, UserConfigTable,
            };
            let native = tokens::SERVICE;
            let Some(t) = foreign::<_, TokenTable>(native).get_index_pk().get(&token) else {
                continue;
            };
            token_data.push(metadata(&t));
            let outgoing = foreign::<_, SharedBalanceTable>(native)
                .get_index_by_creditor_debitor_token()
                .get(&(owner, service, token))
                .map(|b| b.balance.value)
                .unwrap_or(0);
            let incoming = foreign::<_, SharedBalanceTable>(native)
                .get_index_by_creditor_debitor_token()
                .get(&(service, owner, token))
                .map(|b| b.balance.value)
                .unwrap_or(0);
            let wallet = foreign::<_, BalanceTable>(native)
                .get_index_pk()
                .get(&(owner, token))
                .map(|b| b.balance.value)
                .unwrap_or(0);
            let flags = foreign::<_, BalanceConfigTable>(native)
                .get_index_pk()
                .get(&(owner, token))
                .map(|r| r.flags)
                .unwrap_or_else(|| {
                    foreign::<_, UserConfigTable>(native)
                        .get_index_pk()
                        .get(&owner)
                        .map(|r| r.flags)
                        .unwrap_or(0)
                });
            balances.push(json!({"token":token,"wallet":integer(wallet as u128),"incoming":integer(incoming as u128),"outgoing":integer(outgoing as u128),"spendable":integer(outgoing as u128+incoming as u128),"auto_debit":flags&1!=0}));
        }
    }
    let ms:Vec<Value>=markets.iter().map(|m|json!({"id":m.id,"base":m.base,"quote":m.quote,"base_lot":m.base_lot,"quote_tick":m.quote_tick,"x":m.x,"y":m.y,"k":m.k.to_string(),"lp_supply":m.lp_supply,"vault_base":m.vault_base,"vault_quote":m.vault_quote,"debt_base":m.debt_base,"debt_quote":m.debt_quote,"lending_base":m.lending_base,"lending_quote":m.lending_quote,"maturity":m.maturity,"margin_enabled":m.margin_enabled==Some(true),"legacy_unsupported":m.margin_enabled.is_none(),"escrow_base":escrow_view(m.id,m.base,include_native),"escrow_quote":escrow_view(m.id,m.quote,include_native)})).collect();
    let mut result = json!({"owner":owner,"markets":ms,"levels":levels,"positions":positions,"loans":loans,"loan_positions":loan_positions,"lenders":lenders,"relay_shares":relay_shares,"balances":balances,"tokens":token_data});
    preserve_integers(&mut result);
    result.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
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
}
