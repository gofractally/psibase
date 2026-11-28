//! Bounded public explorer queries. Cursors are exclusive for descending history.
use btcbridge::*;
use psibase::*;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
fn foreign<R: TableRecord, T: Table<R>>() -> T {
    T::from_handle(KvHandle::open_direct(
        R::DB,
        &psio::to_key(&(T::SERVICE, T::TABLE_INDEX)),
        KvMode::Read,
    ))
}
fn decode(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut out = vec![];
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                if i + 2 >= bytes.len() {
                    return Err("Invalid query encoding".into());
                }
                let hi = (bytes[i + 1] as char)
                    .to_digit(16)
                    .ok_or("Invalid query encoding")?;
                let lo = (bytes[i + 2] as char)
                    .to_digit(16)
                    .ok_or("Invalid query encoding")?;
                out.push((hi * 16 + lo) as u8);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(out).map_err(|_| "Invalid query encoding".into())
}
fn parameters(query: &str) -> Result<BTreeMap<String, String>, String> {
    let mut result = BTreeMap::new();
    for part in query.split('&').filter(|s| !s.is_empty()) {
        let (key, value) = part.split_once('=').ok_or("Invalid query parameter")?;
        if result.insert(decode(key)?, decode(value)?).is_some() {
            return Err("Duplicate query parameter".into());
        }
    }
    Ok(result)
}
fn key_cursor(value: &str) -> Result<String, String> {
    let (txid, vout) = value.split_once('-').ok_or("Invalid cursor")?;
    if txid.len() != 64
        || vout.len() != 8
        || !txid
            .bytes()
            .chain(vout.bytes())
            .all(|b| b.is_ascii_hexdigit())
    {
        return Err("Invalid cursor".into());
    }
    Ok(format!("{}:{}", txid.to_lowercase(), vout.to_lowercase()))
}
fn height_cursor(value: &str) -> Result<(u32, String), String> {
    let (height, key) = value.split_once('-').ok_or("Invalid cursor")?;
    Ok((
        height.parse().map_err(|_| "Invalid cursor")?,
        key_cursor(key)?,
    ))
}
fn cursor(height: u32, id: &str) -> String {
    format!("{}-{}", height, id.replace(':', "-"))
}
fn page<T: Serialize>(mut rows: Vec<T>, limit: usize, next: impl FnOnce(&T) -> String) -> Value {
    let more = rows.len() > limit;
    rows.truncate(limit);
    let next = if more { rows.last().map(next) } else { None };
    json!({"rows":rows,"next":next})
}
/// History from the node's event log: rows of one of this service's events, newest first.
/// A node may prune its events; this returns what the node still has. Numbers the event log
/// returns as text are made numbers again, so rows read like the table rows they replace.
fn events(
    event: &str,
    filter: Option<(&str, String)>,
    before: Option<u64>,
    limit: usize,
    numbers: &[&str],
) -> Result<Vec<Value>, String> {
    let mut sql = format!("SELECT ROWID, * FROM \"history.btcbridge.{event}\"");
    let mut filters = vec![];
    let mut params: Vec<psio::pssz::RawString> = vec![];
    if let Some((column, value)) = filter {
        filters.push(format!("{column} = ?"));
        params.push(value.as_str().into());
    }
    if let Some(before) = before {
        filters.push(format!("ROWID < {before}"));
    }
    if !filters.is_empty() {
        sql += " WHERE ";
        sql += &filters.join(" AND ");
    }
    sql += &format!(" ORDER BY ROWID DESC LIMIT {limit}");
    let json = psibase::services::r_events::Wrapper::call().sqlQuery(sql, params);
    let mut rows: Vec<Value> =
        serde_json::from_slice(&json).map_err(|_| "Event history unavailable")?;
    for row in &mut rows {
        for name in numbers {
            if let Some(n) = row[*name].as_str().and_then(|s| s.parse::<u64>().ok()) {
                row[*name] = json!(n);
            }
        }
        if let Some(flag) = row["legacy"].as_str().map(|s| s == "true" || s == "1") {
            row["legacy"] = json!(flag);
        } else if let Some(n) = row["legacy"].as_u64() {
            row["legacy"] = json!(n != 0);
        }
    }
    Ok(rows)
}
fn event_cursor(row: &Value) -> String {
    let id = &row["rowid"];
    id.as_str().map(str::to_string).unwrap_or_else(|| id.to_string())
}
const DEPOSIT_NUMBERS: &[&str] = &[
    "vout", "address_index", "value", "credited", "fee", "bounty", "fee_bps", "publisher_bps",
    "height", "credited_at",
];
const REQUEST_NUMBERS: &[&str] = &[
    "id", "amount", "max_fee", "service_fee", "created", "retired", "prior_status", "batch",
    "paid_fee",
];
fn revision_summary(r: &Revision) -> Value {
    let plan: btcbridge_core::Plan = serde_json::from_str(&r.plan).unwrap();
    let gathered: Vec<_> = (0..3u8)
        .filter(|s| {
            SignatureTable::read()
                .get_index_pk()
                .get(&(r.batch, r.revision, *s))
                .is_some()
        })
        .collect();
    let mut published = [0usize; 3];
    for link in SigningLinkTable::read()
        .get_index_pk()
        .range((r.batch, r.revision, 0, 0)..=(r.batch, r.revision, 2, u32::MAX))
    {
        if foreign::<_, signing::HashRequestTable>()
            .get_index_pk()
            .get(&link.request)
            .is_some_and(|h| !h.signature.is_empty())
        {
            published[link.signer as usize] += 1;
        }
    }
    let published_signers: Vec<_> = (0..3)
        .filter(|i| published[*i] == plan.inputs.len() && !plan.inputs.is_empty())
        .collect();
    json!({"published_signers":published_signers,"batch":r.batch,"revision":r.revision,"txid":plan.txid,"fee":plan.fee,"change":plan.change,
        "input_count":plan.inputs.len(),"output_count":plan.payments.len()+1,"fee_rate":serde_json::from_str::<Value>(&r.policy).unwrap()["fee_rate"],
        "gathered":gathered,"ready":!r.raw.is_empty(),"created":r.created,"authorized_block":r.authorized_block})
}
fn displayed_revision(batch: &Batch) -> u32 {
    if batch.status == 1 {
        TxTable::read()
            .get_index_pk()
            .get(&batch.txid)
            .map(|r| r.revision)
            .unwrap_or(batch.current_revision)
    } else {
        batch.current_revision
    }
}
fn batch_summary(b: &Batch) -> Value {
    let r = RevisionTable::read()
        .get_index_pk()
        .get(&(b.id, displayed_revision(b)))
        .unwrap();
    let revisions: Vec<_> = (0..=b.current_revision)
        .filter_map(|n| RevisionTable::read().get_index_pk().get(&(b.id, n)))
        .map(|r| {
            let plan: btcbridge_core::Plan = serde_json::from_str(&r.plan).unwrap();
            json!({"revision":r.revision,"txid":plan.txid,"ready":!r.raw.is_empty()})
        })
        .collect();
    json!({"batch":b,"transaction":revision_summary(&r),"revisions":revisions})
}
fn batch_detail(id: u32) -> Result<Value, String> {
    let b = BatchTable::read()
        .get_index_pk()
        .get(&id)
        .ok_or("Unknown batch")?;
    let active_revision = displayed_revision(&b);
    let revision = RevisionTable::read()
        .get_index_pk()
        .get(&(id, active_revision))
        .unwrap();
    let plan: btcbridge_core::Plan = serde_json::from_str(&revision.plan).unwrap();
    let links: Vec<_> = SigningLinkTable::read()
        .get_index_pk()
        .range((id, active_revision, 0, 0)..=(id, active_revision, 2, u32::MAX))
        .collect();
    let requests: Vec<_> = links
        .iter()
        .filter_map(|l| {
            foreign::<_, signing::HashRequestTable>()
                .get_index_pk()
                .get(&l.request)
        })
        .collect();
    let providers:Vec<_>=CustodyKeyTable::read().get_index_pk().iter().map(|key| {
        let signer_links:Vec<_>=links.iter().filter(|l|l.signer==key.signer).collect();
        let signed=signer_links.iter().filter(|l|requests.iter().any(|r|r.id==l.request&&!r.signature.is_empty())).count();
        json!({"signer":key.signer,"provider":key.provider,"requested":signer_links.len(),"signed":signed,"total":plan.inputs.len(),
            "gathered":SignatureTable::read().get_index_pk().get(&(id,active_revision,key.signer)).is_some()})
    }).collect();
    let inputs:Vec<_>=plan.inputs.iter().enumerate().map(|(n,i)| {
        let proofs:Vec<_>=links.iter().filter(|l|l.input==n as u32).map(|l| {
            let r=requests.iter().find(|r|r.id==l.request);
            json!({"signer":l.signer,"request":l.request,"published":r.map(|r|!r.signature.is_empty()).unwrap_or(false),"hash":r.map(|r|&r.hash)})
        }).collect();
        json!({"input":i,"signatures":proofs,"utxo":UtxoTable::read().get_index_pk().get(&i.id())})
    }).collect();
    let revisions: Vec<_> = (0..=b.current_revision)
        .filter_map(|n| RevisionTable::read().get_index_pk().get(&(id, n)))
        .map(|r| revision_summary(&r))
        .collect();
    let withdrawals: Vec<_> = b
        .requests
        .iter()
        .filter_map(|id| RequestTable::read().get_index_pk().get(id))
        .collect();
    Ok(
        json!({"batch":b,"transaction":revision_summary(&revision),"raw":revision.raw,"unsigned":plan.unsigned,"providers":providers,"inputs":inputs,
        "withdrawals":withdrawals,"revisions":revisions,"required":2,"available":3}),
    )
}
pub fn serve(path: &str, query: &str) -> Option<HttpReply> {
    if !path.starts_with("/explorer/") && path != "/deposit-address" {
        return None;
    }
    let result = (|| -> Result<Value, String> {
        let q = parameters(query)?;
        let limit = q
            .get("limit")
            .map(|v| v.parse::<usize>())
            .transpose()
            .map_err(|_| "Invalid page size")?
            .unwrap_or(if path == "/explorer/batches" { 5 } else { 25 });
        if !(1..=50).contains(&limit) {
            return Err("Page size must be between 1 and 50".into());
        }
        let owner = q
            .get("owner")
            .map(|v| AccountNumber::from_exact(v).map_err(|_| "Invalid account"))
            .transpose()?;
        let after = q.get("cursor");
        match path {
            "/deposit-address" => {
                let script = q.get("script").ok_or("Missing output script")?;
                if script.len() != 68 || !script.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Ok(Value::Null);
                }
                let row = ScriptTable::read()
                    .get_index_pk()
                    .get(&script.to_lowercase())
                    .filter(|s| s.branch == 0)
                    .and_then(|s| AddressTable::read().get_index_pk().get(&s.index));
                Ok(json!(row))
            }
            "/explorer/utxos" => {
                let status = q.get("status").map(String::as_str).unwrap_or("all");
                let rows = if status == "all" {
                    let start = after
                        .map(|s| key_cursor(s))
                        .transpose()?
                        .unwrap_or_default();
                    UtxoTable::read()
                        .get_index_pk()
                        .range(start.clone()..)
                        .filter(|r| after.is_none() || r.id > start)
                        .take(limit + 1)
                        .collect::<Vec<_>>()
                } else {
                    let status: u8 = status.parse().map_err(|_| "Invalid UTXO status")?;
                    if status > 2 {
                        return Err("Invalid UTXO status".into());
                    }
                    let (height, id) = after
                        .map(|s| height_cursor(s))
                        .transpose()?
                        .unwrap_or((0, String::new()));
                    UtxoTable::read()
                        .get_index_by_status()
                        .range((status, height, id.clone())..=(status, u32::MAX, "z".into()))
                        .filter(|u| {
                            after.is_none() || (u.height, u.id.as_str()) > (height, id.as_str())
                        })
                        .take(limit + 1)
                        .collect::<Vec<_>>()
                };
                let next = if rows.len() > limit {
                    rows.get(limit - 1).map(|r| {
                        if status == "all" {
                            r.id.replace(':', "-")
                        } else {
                            cursor(r.height, &r.id)
                        }
                    })
                } else {
                    None
                };
                let rows:Vec<_>=rows.into_iter().take(limit).map(|u| {
                    let address=if u.branch==0 {AddressTable::read().get_index_pk().get(&u.index)}else{None};
                    json!({"utxo":u,"address":address})
                }).collect();
                Ok(json!({"rows":rows,"next":next}))
            }
            // A deposit's receipt is an event; `null` if this node no longer has it.
            "/explorer/deposit" => Ok(json!(events(
                "depositCredited",
                Some(("id", key_cursor(q.get("outpoint").ok_or("Missing outpoint")?)?)),
                None,
                1,
                DEPOSIT_NUMBERS,
            )?
            .into_iter()
            .next())),
            "/explorer/transaction" => {
                let txid = q.get("txid").ok_or("Missing transaction ID")?;
                if txid.len() != 64 || !txid.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Err("Invalid transaction ID".into());
                }
                Ok(json!(TxTable::read()
                    .get_index_pk()
                    .get(&txid.to_lowercase())))
            }
            "/explorer/deposits" => {
                let before = after
                    .map(|s| s.parse::<u64>())
                    .transpose()
                    .map_err(|_| "Invalid cursor")?;
                let rows = events(
                    "depositCredited",
                    owner.map(|o| ("owner", o.to_string())),
                    before,
                    limit + 1,
                    DEPOSIT_NUMBERS,
                )?;
                Ok(page(rows, limit, event_cursor))
            }
            // Requests that left objective state (cancelled), from the event log: newest first.
            // A node may prune its events; this returns what the node still has.
            // Requests that left objective state (cancelled), from the event log.
            "/explorer/retired" => {
                let before = after
                    .map(|s| s.parse::<u64>())
                    .transpose()
                    .map_err(|_| "Invalid cursor")?;
                let rows = events(
                    "withdrawalRetired",
                    owner.map(|o| ("owner", o.to_string())),
                    before,
                    limit + 1,
                    REQUEST_NUMBERS,
                )?;
                Ok(page(rows, limit, event_cursor))
            }
            "/explorer/withdrawals" => {
                let end = after
                    .map(|s| s.parse::<u64>())
                    .transpose()
                    .map_err(|_| "Invalid cursor")?
                    .unwrap_or(u64::MAX);
                let rows = if let Some(owner) = owner {
                    RequestTable::read()
                        .get_index_by_owner()
                        .range(..(owner, end))
                        .rev()
                        .take_while(|r| r.owner == owner)
                        .take(limit + 1)
                        .collect::<Vec<_>>()
                } else {
                    RequestTable::read()
                        .get_index_pk()
                        .range(..end)
                        .rev()
                        .take(limit + 1)
                        .collect::<Vec<_>>()
                };
                let next = if rows.len() > limit {
                    rows.get(limit - 1).map(|r| r.id.to_string())
                } else {
                    None
                };
                let rows: Vec<_> = rows
                    .into_iter()
                    .take(limit)
                    .map(|w| {
                        let batch = if w.batch != 0 {
                            BatchTable::read()
                                .get_index_pk()
                                .get(&w.batch)
                                .map(|b| batch_summary(&b))
                        } else {
                            None
                        };
                        json!({"withdrawal":w,"batch":batch})
                    })
                    .collect();
                Ok(json!({"rows":rows,"next":next}))
            }
            "/explorer/batches" => {
                if limit > 10 {
                    return Err("Batch page size must be between 1 and 10".into());
                }
                let end = after
                    .map(|s| s.parse::<u32>())
                    .transpose()
                    .map_err(|_| "Invalid cursor")?
                    .unwrap_or(u32::MAX);
                let status = q.get("status").map(String::as_str).unwrap_or("0");
                let rows = if status == "all" {
                    BatchTable::read()
                        .get_index_pk()
                        .range(..end)
                        .rev()
                        .take(limit + 1)
                        .collect::<Vec<_>>()
                } else {
                    let status: u8 = status.parse().map_err(|_| "Invalid batch status")?;
                    if status > 1 {
                        return Err("Invalid batch status".into());
                    }
                    BatchTable::read()
                        .get_index_by_status()
                        .range(..(status, end))
                        .rev()
                        .take_while(|b| b.status == status)
                        .take(limit + 1)
                        .collect::<Vec<_>>()
                };
                let next = if rows.len() > limit {
                    rows.get(limit - 1).map(|r| r.id.to_string())
                } else {
                    None
                };
                Ok(
                    json!({"rows":rows.iter().take(limit).map(batch_summary).collect::<Vec<_>>(),"next":next}),
                )
            }
            "/explorer/batch" => batch_detail(
                q.get("id")
                    .ok_or("Missing batch ID")?
                    .parse()
                    .map_err(|_| "Invalid batch ID")?,
            ),
            "/explorer/addresses" => {
                let start = after
                    .map(|s| s.parse::<u32>())
                    .transpose()
                    .map_err(|_| "Invalid cursor")?
                    .unwrap_or(0);
                let rows = if let Some(owner) = owner {
                    AddressTable::read()
                        .get_index_by_owner()
                        .range((owner, start)..=(owner, u32::MAX))
                        .filter(|r| after.is_none() || r.index > start)
                        .take(limit + 1)
                        .collect::<Vec<_>>()
                } else {
                    AddressTable::read()
                        .get_index_pk()
                        .range(start..)
                        .filter(|r| after.is_none() || r.index > start)
                        .take(limit + 1)
                        .collect::<Vec<_>>()
                };
                Ok(page(rows, limit, |r| r.index.to_string()))
            }
            _ => Err("Unknown explorer endpoint".into()),
        }
    })();
    let (status, body) = match result {
        Ok(v) => (200, v),
        Err(error) => (400, json!({"error":error})),
    };
    Some(HttpReply {
        status,
        contentType: "application/json".into(),
        body: body.to_string().into_bytes().into(),
        headers: vec![HttpHeader {
            name: "Cache-Control".into(),
            value: "no-store".into(),
        }],
    })
}
