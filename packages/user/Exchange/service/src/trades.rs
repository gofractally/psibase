//! Recent executions from the existing native event log. No synthetic history
//! and no second mutable trade ledger. These are aggregate taker, liquidation,
//! and stop-batch executions; amounts determine each record's realized VWAP.
//! Event order is commit order, not the auction's simulated marginal-price path.

use psibase::{AccountNumber, DbId, KvHandle, KvMode, MethodNumber, ServiceWrapper};
use serde_json::{json, Value};

pub const MAX_PAGE: u32 = 100;

#[derive(psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText)]
struct IndexInfo {
    index_num: u8,
}
#[derive(psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText)]
struct ReadyIndex {
    db: u8,
    service: AccountNumber,
    event: MethodNumber,
    indexes: Vec<IndexInfo>,
}

pub(crate) fn indexed_ids(
    market: u64,
    method: &str,
    limit: u32,
    before: Option<u64>,
    after: Option<u64>,
) -> Result<Vec<u64>, String> {
    let service = psibase::account!("events+2");
    let event = MethodNumber::from(method);
    let ready = KvHandle::open_direct(DbId::WriteOnly, &psio::to_key(&(service, 7_u16)), KvMode::Read);
    let key = psio::to_key(&(0_u8, 0_u8, crate::SERVICE, event));
    let row =
        psibase::kv_get_bytes(&ready, &key).and_then(|bytes| psio::from_pssz::<ReadyIndex>(&bytes).ok());
    let is_ready = row
        .map(|row| {
            row.db == 0
                && row.service == crate::SERVICE
                && row.event == event
                && row.indexes.iter().any(|i| i.index_num == 0)
        })
        .unwrap_or(false);
    if !is_ready {
        return Err("Native trade history index is synchronizing".into());
    }
    let handle = KvHandle::open_direct(DbId::WriteOnly, &psio::to_key(&(service, 1_u16)), KvMode::Read);
    let prefix = psio::to_key(&(0_u8, crate::SERVICE, event, 0_u8, market));
    let mut cursor = prefix.clone();
    let mut found = if let Some(id) = before {
        cursor.extend_from_slice(&id.to_be_bytes());
        psibase::kv_less_than_bytes(&handle, &cursor, prefix.len() as u32)
    } else {
        psibase::kv_max_bytes(&handle, &prefix)
    };
    let mut ids = Vec::new();
    while found.is_some() && ids.len() < (limit + 1) as usize {
        cursor = psibase::get_key_bytes();
        if cursor.len() != prefix.len() + 8 || !cursor.starts_with(&prefix) {
            return Err("Invalid native trade index key".into());
        }
        let id = u64::from_be_bytes(cursor[cursor.len() - 8..].try_into().unwrap());
        // The native index is descending. Once the exclusive lower bound is
        // reached no older key can belong to this incremental page.
        if after.map(|after| id <= after).unwrap_or(false) {
            break;
        }
        ids.push(id);
        if ids.len() == (limit + 1) as usize {
            break;
        }
        found = psibase::kv_less_than_bytes(&handle, &cursor, prefix.len() as u32);
    }
    Ok(ids)
}

fn query(market: u64, limit: u32, normal: &[u64], liquidations: &[u64], stops: &[u64]) -> String {
    // These IDs come from at most limit+1 native index seeks per event type.
    // SQL fetches by exact ROWID, never scans/sorts the complete event history.
    let ids = |values: &[u64]| {
        if values.is_empty() {
            "0".to_string()
        } else {
            values
                .iter()
                .map(u64::to_string)
                .collect::<Vec<_>>()
                .join(",")
        }
    };
    let trades = ids(normal);
    let liquidated = ids(liquidations);
    let stop_trades = ids(stops);
    format!(
        "WITH recent AS (SELECT * FROM (\
         SELECT ROWID AS event_id,market,sell_base,input,output,'trade' AS kind \
         FROM \"history.exchange.traded\" WHERE ROWID IN ({trades}) AND market={market} UNION ALL \
         SELECT ROWID AS event_id,market,long AS sell_base,collateral AS input,\
         debt+surplus AS output,'liquidation' AS kind \
         FROM \"history.exchange.liquidated\" WHERE ROWID IN ({liquidated}) AND market={market} UNION ALL \
         SELECT ROWID AS event_id,market,sell_base,input,output,'stop' AS kind \
         FROM \"history.exchange.stoptraded\" WHERE ROWID IN ({stop_trades}) AND market={market}) \
         ORDER BY event_id DESC LIMIT {}) \
         SELECT r.*,b.blockNum,b.blockTime FROM recent r \
         LEFT JOIN \"history.transact.blockStart\" b ON b.ROWID=(\
         SELECT ROWID FROM \"history.transact.blockStart\" \
         WHERE ROWID<=r.event_id ORDER BY ROWID DESC LIMIT 1) \
         ORDER BY r.event_id DESC",
        limit + 1
    )
}

fn number(row: &Value, field: &str) -> Result<u64, String> {
    let value = &row[field];
    value
        .as_u64()
        .or_else(|| value.as_str()?.parse().ok())
        .ok_or_else(|| format!("Invalid native history field: {field}"))
}

fn normalize(raw: &str, market: u64, limit: u32) -> Result<String, String> {
    let rows: Vec<Value> =
        serde_json::from_str(raw).map_err(|_| "Invalid native history response".to_string())?;
    if rows.len() > limit as usize + 1 {
        return Err("Native history page exceeded its bound".into());
    }
    let more = rows.len() > limit as usize;
    let mut trades = Vec::new();
    let mut previous = None;
    for row in rows.into_iter().take(limit as usize) {
        let event_id = number(&row, "event_id")?;
        let row_market = number(&row, "market")?;
        if row_market != market
            || previous
                .map(|previous| event_id >= previous)
                .unwrap_or(false)
        {
            return Err("Native history market/order mismatch".into());
        }
        previous = Some(event_id);
        let sell_base = match &row["sell_base"] {
            Value::Bool(value) => *value,
            value if value.as_str() == Some("0") || value.as_u64() == Some(0) => false,
            value if value.as_str() == Some("1") || value.as_u64() == Some(1) => true,
            _ => return Err("Invalid native history trade side".into()),
        };
        let input = number(&row, "input")?;
        let output = number(&row, "output")?;
        let kind = row["kind"]
            .as_str()
            .filter(|v| *v == "trade" || *v == "liquidation" || *v == "stop")
            .ok_or_else(|| "Invalid native history execution kind".to_string())?;
        let (base, quote) = if sell_base {
            (input, output)
        } else {
            (output, input)
        };
        let block = if row["blockNum"].is_null() {
            Value::Null
        } else {
            Value::String(number(&row, "blockNum")?.to_string())
        };
        let time = match &row["blockTime"] {
            Value::Null => Value::Null,
            Value::String(value) => Value::String(value.clone()),
            _ => return Err("Invalid native history block time".into()),
        };
        // Always decimal strings for IDs and token atoms, including values
        // above JavaScript's safe integer range. Time comes from the block.
        trades.push(
            json!({"event_id":event_id.to_string(),"market":market.to_string(),
            "side":if sell_base{"sell"}else{"buy"},"sell_base":sell_base,
            "base_amount":base.to_string(),"quote_amount":quote.to_string(),
            "block_num":block,"time":time,"kind":kind}),
        );
    }
    let next = if more {
        trades.last().map(|row| row["event_id"].clone())
    } else {
        None
    };
    Ok(
        json!({"market":market.to_string(),"source":"native-history",
        "aggregation":"native-aggregate-execution","trades":trades,"next_before":next})
        .to_string(),
    )
}

/// Newest first in the exclusive range (after, before). To drain a delta larger
/// than one page, retain `after` and follow `next_before` until it is null.
pub fn read(
    market: u64,
    limit: u32,
    before: Option<u64>,
    after: Option<u64>,
) -> Result<String, String> {
    if market == 0 || limit == 0 || limit > MAX_PAGE {
        return Err("Invalid market or native trade page size".into());
    }
    if before
        .zip(after)
        .map(|(before, after)| after >= before)
        .unwrap_or(false)
    {
        return normalize("[]", market, limit);
    }
    let normal = indexed_ids(market, "traded", limit, before, after)?;
    let liquidations = indexed_ids(market, "liquidated", limit, before, after)?;
    let stops = indexed_ids(market, "stoptraded", limit, before, after)?;
    if normal.is_empty() && liquidations.is_empty() && stops.is_empty() {
        return normalize("[]", market, limit);
    }
    let sql = query(market, limit, &normal, &liquidations, &stops);
    let raw = psibase::services::r_events::Wrapper::call().sqlQuery(sql, vec![]);
    let raw = String::from_utf8(raw).map_err(|_| "Invalid native trade response")?;
    normalize(&raw, market, limit)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn actual_amounts_sides_time_and_cursor() {
        let raw = r#"[{"event_id":"9007199254740998","market":"7","sell_base":"0","input":"18446744073709551615","output":"11","kind":"trade","blockNum":"8","blockTime":"2026-11-21T06:00:00.000000Z"},{"event_id":"9","market":"7","sell_base":"1","input":"12","output":"13","kind":"liquidation","blockNum":null,"blockTime":null},{"event_id":"8"}]"#;
        let page: Value = serde_json::from_str(&normalize(raw, 7, 2).unwrap()).unwrap();
        assert_eq!(page["trades"][0]["base_amount"], "11");
        assert_eq!(page["trades"][0]["quote_amount"], u64::MAX.to_string());
        assert_eq!(page["trades"][0]["side"], "buy");
        assert_eq!(page["trades"][0]["time"], "2026-11-21T06:00:00.000000Z");
        assert_eq!(page["trades"][1]["base_amount"], "12");
        assert_eq!(page["trades"][1]["kind"], "liquidation");
        assert!(page["trades"][1]["time"].is_null());
        assert_eq!(page["next_before"], "9");
    }
    #[test]
    fn empty_history_and_invalid_source_are_not_fabricated() {
        let page: Value = serde_json::from_str(&normalize("[]", 1, 10).unwrap()).unwrap();
        assert_eq!(page["trades"], json!([]));
        assert!(page["next_before"].is_null());
        assert!(normalize("not JSON", 1, 10).is_err());
        assert!(normalize(r#"[{"event_id":"2","market":"9"}]"#, 1, 10).is_err());
    }
    #[test]
    fn query_fetches_only_exact_native_index_ids() {
        let sql = query(17, 50, &[99, 95], &[98], &[96]);
        assert!(sql.contains("ROWID IN (99,95) AND market=17"));
        assert!(sql.contains("ROWID IN (98) AND market=17"));
        assert!(sql.contains("ROWID IN (96) AND market=17"));
        assert!(sql.contains("LIMIT 51"));
        assert!(sql.contains("history.transact.blockStart"));
    }
}
