//! Bounded, public explorer. No transaction construction or account impersonation.
#[psibase::service(name = "ethbridge+1")]
#[allow(non_snake_case)]
pub mod service {
    use psibase::*;
    use serde_json::{json, Value};
    fn foreign<R: TableRecord, T: Table<R>>() -> T {
        T::from_handle(KvHandle::open_direct(
            R::DB,
            &psio::to_key(&(T::SERVICE, T::TABLE_INDEX)),
            KvMode::Read,
        ))
    }
    // Preserve u64 identifiers/amounts through JavaScript JSON consumers.
    // Ordinary small counters remain numbers; values above 2^53-1 are decimal strings.
    fn browser_safe(value: Value) -> Value {
        match value {
            Value::Number(n) if n.as_u64().is_some_and(|n| n > 9_007_199_254_740_991) => {
                Value::String(n.to_string())
            }
            Value::Array(values) => Value::Array(values.into_iter().map(browser_safe).collect()),
            Value::Object(values) => Value::Object(
                values
                    .into_iter()
                    .map(|(key, value)| (key, browser_safe(value)))
                    .collect(),
            ),
            value => value,
        }
    }
    fn reply(status: u16, value: Value) -> Option<HttpReply> {
        let value = browser_safe(value);
        Some(HttpReply {
            status,
            contentType: "application/json".into(),
            body: value.to_string().into_bytes().into(),
            headers: vec![HttpHeader {
                name: "Cache-Control".into(),
                value: "no-store".into(),
            }],
        })
    }
    #[action]
    #[allow(unused_variables)]
    fn serveSys(
        request: HttpRequest,
        socket: Option<i32>,
        user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        assert_eq!(
            get_sender(),
            psibase::services::http_server::SERVICE,
            "Native HTTP server required"
        );
        let target = request.target.to_string_lossy();
        let (path, query) = target.split_once('?').unwrap_or((&target, ""));
        if request.method == "GET" {
            if let Some(id) = request.target.to_string_lossy().strip_prefix("/header?hash=") {
                if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return reply(400, json!({"error":"Invalid Ethereum hash"}));
                }
                return reply(
                    200,
                    json!(foreign::<_, ethrelay::HeaderTable>()
                        .get_index_pk()
                        .get(&id.to_lowercase())),
                );
            }
            if let Some(id) = request.target.to_string_lossy().strip_prefix("/deposit?id=") {
                let id = id.parse::<u64>().ok()?;
                return reply(
                    200,
                    json!(ethbridge::DepositTable::read().get_index_pk().get(&id)),
                );
            }
            if let Some(owner) = request.target.to_string_lossy().strip_prefix("/balance?owner=") {
                let owner = owner.parse::<AccountNumber>().ok()?;
                let config = ethbridge::ConfigTable::read().get_index_pk().get(&())?;
                let amount =
                    psibase::services::tokens::Wrapper::call().getBalance(config.token, owner);
                return reply(
                    200,
                    json!({"owner":owner,"token":config.token,"units":amount.value.to_string()}),
                );
            }
            if path == "/snapshot" {
                return reply(
                    200,
                    json!({"config":ethbridge::ConfigTable::read().get_index_pk().get(&()),"amounts":ethbridge::ConfigTable::read().get_index_pk().get(&()).map(|c|json!({"reserve":c.reserve.to_string(),"liability":c.liability.to_string(),"withdrawal_fee":c.withdrawal_fee.to_string()})),"custody":ethbridge::CustodyTable::read().get_index_pk().iter().take(3).collect::<Vec<_>>(),"relay":foreign::<_,ethrelay::RelayTable>().get_index_pk().get(&()),"depositSelector":"13765838","vaultCodeHash":ethbridge::VAULT_CODE_HASH.trim(),"now":psibase::services::transact::Wrapper::call().currentBlock().time.floor::<psibase::psio::time::Seconds>().ticks()}),
                );
            }
            let values: std::collections::BTreeMap<_, _> =
                query.split('&').filter_map(|v| v.split_once('=')).collect();
            let after = values.get("after").unwrap_or(&"0").parse::<u64>();
            let limit = values.get("limit").unwrap_or(&"50").parse::<usize>();
            let (Ok(after), Ok(limit)) = (after, limit) else {
                return reply(400, json!({"error":"Invalid page cursor"}));
            };
            if !(1..=100).contains(&limit) {
                return reply(400, json!({"error":"Page size limit"}));
            }
            macro_rules! page {($table:ty,$id:ident)=>{{let rows:Vec<_>=<$table>::read().get_index_pk().range(after..).filter(|r|r.$id>after).take(limit+1).collect();let more=rows.len()>limit;let shown:Vec<_>=rows.into_iter().take(limit).collect();let next=if more{shown.last().map(|r|r.$id)}else{None};return reply(200,json!({"rows":shown,"next":next}));}}}
            match path {
                "/deposits" => page!(ethbridge::DepositTable, id),
                "/withdrawals" => page!(ethbridge::RequestTable, id),
                "/batches" => {
                    // Batch nonce zero is valid; first-page cursor is omitted rather than zero.
                    let from = if values.contains_key("after") {
                        after.checked_add(1).unwrap_or(u64::MAX)
                    } else {
                        0
                    };
                    let rows: Vec<_> = ethbridge::BatchTable::read()
                        .get_index_pk()
                        .range(from..)
                        .take(limit + 1)
                        .collect();
                    let more = rows.len() > limit;
                    let shown: Vec<_> = rows.into_iter().take(limit).collect();
                    let next = if more {
                        shown.last().map(|r| r.nonce)
                    } else {
                        None
                    };
                    return reply(200, json!({"rows":shown,"next":next}));
                }
                _ => {}
            }
        }
        serve_action_templates::<ethbridge::Wrapper>(&request)
            .or_else(|| serve_pack_action::<ethbridge::Wrapper>(&request))
            .or_else(|| serve_action_templates::<ethrelay::Wrapper>(&request))
            .or_else(|| serve_pack_action::<ethrelay::Wrapper>(&request))
    }
}
