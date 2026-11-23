//! Exact execution candles. Five current rows per market bound objective state;
//! completed nonempty bars live only in native prunable history. Recording is
//! constant work per aggregate execution, independent of resting owners/history.
use crate::{math::Wide, tables::tables::*};
use psibase::{KvHandle, KvMode, ServiceWrapper, Table, TableRecord};
use serde_json::{json, Value};
async_graphql::scalar!(Wide);
pub const INTERVALS: [u32; 5] = [5, 15, 60, 3600, 86400];
pub const MAX_PAGE: u32 = 200;
fn event(interval: u32) -> Result<&'static str, String> {
    match interval {
        5 => Ok("candle5s"),
        15 => Ok("candle15s"),
        60 => Ok("candle1m"),
        3600 => Ok("candle1h"),
        86400 => Ok("candle1d"),
        _ => Err("Unsupported candle interval".into()),
    }
}
fn less(a: &CandlePrice, b: &CandlePrice) -> bool {
    (a.quote as u128 * b.base as u128) < (b.quote as u128 * a.base as u128)
}
/// Pure transition shared with deterministic arithmetic tests. None means that
/// a zero-sided execution has no price and must not alter candles or volume.
pub fn advance(
    previous: Option<&CurrentCandle>,
    market: u64,
    interval: u32,
    time: u64,
    base: u64,
    quote: u64,
) -> Option<(CurrentCandle, Option<CurrentCandle>)> {
    assert!(INTERVALS.contains(&interval), "supported candle interval");
    if base == 0 || quote == 0 {
        return None;
    }
    let bucket = time / interval as u64 * interval as u64;
    let price = CandlePrice { base, quote };
    if let Some(previous) = previous {
        assert!(
            previous.market == market && previous.interval == interval,
            "candle scope"
        );
        assert!(bucket >= previous.bucket, "monotone candle time");
        if previous.bucket == bucket {
            let mut candle = previous.clone();
            if less(&price, &candle.low) {
                candle.low = price.clone();
            }
            if less(&candle.high, &price) {
                candle.high = price.clone();
            }
            candle.close = price;
            candle.volume_base = candle
                .volume_base
                .get()
                .checked_add(base as u128)
                .expect("candle base volume overflow")
                .into();
            candle.volume_quote = candle
                .volume_quote
                .get()
                .checked_add(quote as u128)
                .expect("candle quote volume overflow")
                .into();
            candle.trades = candle.trades.checked_add(1).expect("candle count overflow");
            return Some((candle, None));
        }
    }
    Some((
        CurrentCandle {
            market,
            interval,
            bucket,
            open: price.clone(),
            high: price.clone(),
            low: price.clone(),
            close: price,
            volume_base: (base as u128).into(),
            volume_quote: (quote as u128).into(),
            trades: 1,
        },
        previous.cloned(),
    ))
}
pub fn record(market: u64, sell_base: bool, input: u64, output: u64, time: u64) {
    if input == 0 || output == 0 {
        return;
    }
    let (base, quote) = if sell_base {
        (input, output)
    } else {
        (output, input)
    };
    let table = CurrentCandleTable::read_write();
    for interval in INTERVALS {
        let previous = table.get_index_pk().get(&(market, interval));
        let (current, completed) =
            advance(previous.as_ref(), market, interval, time, base, quote).unwrap();
        if let Some(candle) = completed {
            let emit = crate::Wrapper::emit().history();
            match interval {
                5 => {
                    emit.candle5s(market, candle);
                }
                15 => {
                    emit.candle15s(market, candle);
                }
                60 => {
                    emit.candle1m(market, candle);
                }
                3600 => {
                    emit.candle1h(market, candle);
                }
                86400 => {
                    emit.candle1d(market, candle);
                }
                _ => unreachable!(),
            }
        }
        table.put(&current).unwrap();
    }
}
fn dto(
    candle: &CurrentCandle,
    _price_precision: u8,
    complete: bool,
    event_id: Option<u64>,
) -> Value {
    let scale = 1_000_000_000_000_000_000u128;
    let price = |p: &CandlePrice| (p.quote as u128 * scale / p.base as u128).to_string();
    let mut value = json!({"time":candle.bucket,"open":price(&candle.open),"high":price(&candle.high),"low":price(&candle.low),"close":price(&candle.close),"volume":candle.volume_base.get().to_string(),"quote_volume":candle.volume_quote.get().to_string(),"trades":candle.trades.to_string(),"complete":complete});
    if let Some(id) = event_id {
        value["event_id"] = json!(id.to_string());
    }
    value
}
fn numeric(v: &Value) -> Result<u64, String> {
    v.as_u64()
        .or_else(|| v.as_str()?.parse().ok())
        .ok_or_else(|| "Invalid native candle integer".into())
}
fn ratio(v: &Value) -> Result<CandlePrice, String> {
    let result = CandlePrice {
        base: numeric(&v["base"])?,
        quote: numeric(&v["quote"])?,
    };
    if result.base == 0 || result.quote == 0 {
        return Err("Invalid native candle price".into());
    }
    Ok(result)
}
fn wide(v: &Value) -> Result<Wide, String> {
    Ok(Wide {
        lo: numeric(&v["lo"])?,
        hi: numeric(&v["hi"])?,
    })
}
fn decode(v: &Value) -> Result<CurrentCandle, String> {
    let owned;
    if let Some(raw) = v.as_str() {
        owned = serde_json::from_str::<Value>(raw).map_err(|_| "Invalid native candle JSON")?;
    } else {
        owned = v.clone();
    }
    let v = &owned;
    Ok(CurrentCandle {
        market: numeric(&v["market"])?,
        interval: u32::try_from(numeric(&v["interval"])?).map_err(|_| "Invalid candle interval")?,
        bucket: numeric(&v["bucket"])?,
        open: ratio(&v["open"])?,
        high: ratio(&v["high"])?,
        low: ratio(&v["low"])?,
        close: ratio(&v["close"])?,
        volume_base: wide(&v["volume_base"])?,
        volume_quote: wide(&v["volume_quote"])?,
        trades: numeric(&v["trades"])?,
    })
}
/// Reads at most limit+1 market-indexed event IDs and fetches only those exact
/// ROWIDs. No scan through old executions, no time predicate or history sort.
pub fn read(market: u64, interval: u32, limit: u32, before: Option<u64>) -> Result<String, String> {
    let event = event(interval)?;
    if market == 0 || limit == 0 || limit > MAX_PAGE {
        return Err("Invalid candle market or page size".into());
    }
    let m = MarketTable::with_service(crate::SERVICE)
        .get_index_pk()
        .get(&market)
        .ok_or("Unknown market")?;
    // This is used only by the privileged read-only query service. Native
    // recording never invokes token queries or mutating token getters.
    let prefix = psio::to_key(&(
        tokens::SERVICE,
        tokens::tables::tables::TokenTable::TABLE_INDEX,
    ));
    let token_table = tokens::tables::tables::TokenTable::from_handle(KvHandle::open_direct(
        <tokens::tables::tables::Token as TableRecord>::DB,
        &prefix,
        KvMode::Read,
    ));
    let base = token_table
        .get_index_pk()
        .get(&m.base)
        .ok_or("Unknown candle base asset")?;
    let quote = token_table
        .get_index_pk()
        .get(&m.quote)
        .ok_or("Unknown candle quote asset")?;
    let price_precision = quote.precision.value() + 18 - base.precision.value();
    let current = if before.is_none() {
        CurrentCandleTable::with_service(crate::SERVICE)
            .get_index_pk()
            .get(&(market, interval))
    } else {
        None
    };
    let ids = crate::trades::indexed_ids(market, event, limit, before, None)?;
    let rows: Vec<Value> = if ids.is_empty() {
        vec![]
    } else {
        let keys = ids.iter().map(u64::to_string).collect::<Vec<_>>().join(",");
        let sql=format!("SELECT ROWID AS event_id,market,candle FROM \"history.exchange.{event}\" WHERE ROWID IN ({keys}) AND market={market} ORDER BY ROWID DESC LIMIT {}",limit+1);
        let body = psibase::services::r_events::Wrapper::call().sqlQuery(sql, vec![]);
        serde_json::from_str(&body).map_err(|_| "Invalid native candle response")?
    };
    page(
        market,
        interval,
        limit,
        current.as_ref(),
        &rows,
        price_precision,
    )
}
fn page(
    market: u64,
    interval: u32,
    limit: u32,
    current: Option<&CurrentCandle>,
    rows: &[Value],
    precision: u8,
) -> Result<String, String> {
    if rows.len() > limit as usize + 1 {
        return Err("Native candle page exceeded bound".into());
    }
    let mut candles = vec![];
    if let Some(current) = current {
        candles.push(dto(current, precision, false, None));
    }
    let available = limit as usize - candles.len();
    let mut previous_id = None;
    let mut previous_bucket = current.map(|c| c.bucket);
    let mut last = None;
    for row in rows.iter().take(available) {
        let id = numeric(&row["event_id"])?;
        let candle = decode(&row["candle"])?;
        if numeric(&row["market"])? != market
            || candle.market != market
            || candle.interval != interval
            || candle.trades == 0
            || candle.bucket % interval as u64 != 0
            || previous_id.is_some_and(|p| id >= p)
            || previous_bucket.is_some_and(|p| candle.bucket >= p)
        {
            return Err("Native candle scope/order mismatch".into());
        }
        previous_id = Some(id);
        previous_bucket = Some(candle.bucket);
        last = Some(id);
        candles.push(dto(&candle, precision, true, Some(id)));
    }
    let next = if rows.len() > available {
        // A page of one may contain only the current bar. An exclusive cursor
        // immediately above the newest event includes it on the next page.
        Some(
            last.or_else(|| numeric(&rows[0]["event_id"]).ok()?.checked_add(1))
                .ok_or("Candle cursor exhausted")?
                .to_string(),
        )
    } else {
        None
    };
    Ok(json!({"interval":interval,"price_precision":precision,"candles":candles,"next_before":next}).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_ratio_ohlc_and_wide_volume_do_not_use_float_prices() {
        let (a, _) = advance(None, 1, 3600, 3601, 2, 3).unwrap();
        let (a, _) = advance(Some(&a), 1, 3600, 3602, 1, 2).unwrap();
        let (a, _) = advance(Some(&a), 1, 3600, 3603, 3, 3).unwrap();
        let (mut a, _) = advance(Some(&a), 1, 3600, 3604, 7, 10).unwrap();
        let out = dto(&a, 8, false, None);
        assert_eq!(out["open"], "1500000000000000000");
        assert_eq!(out["high"], "2000000000000000000");
        assert_eq!(out["low"], "1000000000000000000");
        assert_eq!(out["close"], "1428571428571428571");
        assert_eq!(out["volume"], "13");
        assert_eq!(out["quote_volume"], "18");
        assert_eq!(out["trades"], "4");
        a.volume_base = (u64::MAX as u128 + 100).into();
        let (a, _) = advance(Some(&a), 1, 3600, 3605, 1, 1).unwrap();
        assert_eq!(a.volume_base.get(), u64::MAX as u128 + 101);
        assert_eq!(
            decode(&serde_json::to_value(&a).unwrap())
                .unwrap()
                .volume_base
                .get(),
            a.volume_base.get()
        );
    }
    #[test]
    fn hourly_daily_rollover_emits_only_the_actual_previous_bucket() {
        for interval in [3600, 86400] {
            let (a, closed) = advance(None, 7, interval, 1, 10, 30).unwrap();
            assert!(closed.is_none());
            let (b, closed) =
                advance(Some(&a), 7, interval, interval as u64 * 10 + 4, 10, 20).unwrap();
            assert_eq!(closed.unwrap().bucket, 0);
            assert_eq!(b.bucket, interval as u64 * 10);
            assert_eq!(b.trades, 1);
            assert!(advance(Some(&b), 7, interval, b.bucket + 1, 1, 0).is_none());
            assert!(advance(Some(&b), 7, interval, b.bucket + 1, 0, 1).is_none());
        }
    }
    #[test]
    fn history_page_is_newest_first_exclusive_and_current_only_first_page() {
        let (old, _) = advance(None, 1, 60, 1, 2, 10).unwrap();
        let (middle, _) = advance(Some(&old), 1, 60, 60, 2, 20).unwrap();
        let (current, _) = advance(Some(&middle), 1, 60, 120, 2, 30).unwrap();
        let rows = vec![
            json!({"event_id":"11","market":"1","candle":serde_json::to_string(&middle).unwrap()}),
            json!({"event_id":10,"market":1,"candle":old}),
        ];
        let first: Value =
            serde_json::from_str(&page(1, 60, 2, Some(&current), &rows, 4).unwrap()).unwrap();
        assert_eq!(first["candles"][0]["time"], 120);
        assert_eq!(first["candles"][0]["complete"], false);
        assert_eq!(first["candles"][1]["time"], 60);
        assert_eq!(first["next_before"], "11");
        let second: Value =
            serde_json::from_str(&page(1, 60, 2, None, &rows[1..], 4).unwrap()).unwrap();
        assert_eq!(second["candles"][0]["time"], 0);
        assert_eq!(second["candles"][0]["complete"], true);
        assert!(second["next_before"].is_null());
        let one: Value =
            serde_json::from_str(&page(1, 60, 1, Some(&current), &rows, 4).unwrap()).unwrap();
        assert_eq!(one["next_before"], "12");
        let mut bad = rows.clone();
        bad[0]["market"] = json!(2);
        assert!(page(1, 60, 2, None, &bad, 4).is_err());
    }
    #[test]
    fn candle_event_index_mapping_is_fixed_and_unsupported_intervals_fail() {
        assert_eq!(
            INTERVALS.map(|i| event(i).unwrap()),
            ["candle5s", "candle15s", "candle1m", "candle1h", "candle1d"]
        );
        for interval in [0, 1, 30, 300, u32::MAX] {
            assert!(event(interval).is_err());
        }
    }
    #[test]
    fn valid_sub_atom_whole_token_prices_remain_positive_at_fixed18_scale() {
        let (c, _) = advance(None, 1, 5, 5, 100, 1).unwrap();
        assert_eq!(dto(&c, 18, false, None)["close"], "10000000000000000");
        let output: Value =
            serde_json::from_str(&page(1, 5, 1, Some(&c), &[], 18).unwrap()).unwrap();
        assert_eq!(output["price_precision"], 18);
        let (large, _) = advance(None, 1, 5, 5, 1, crate::math::MAX).unwrap();
        assert_eq!(
            dto(&large, 10, false, None)["close"],
            format!(
                "{}",
                crate::math::MAX as u128 * 1_000_000_000_000_000_000u128
            )
        );
    }
}
