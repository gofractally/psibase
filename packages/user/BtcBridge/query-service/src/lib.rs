mod explorer;
#[psibase::service(name = "btcbridge+1")]
#[allow(non_snake_case)]
pub mod service {
    use btcbridge::{
        AddressTable, BatchTable, ConfigTable, CustodyKeyTable, RequestTable, RevisionTable,
        SignatureTable, SigningLinkTable, UtxoTable,
    };
    use psibase::*;
    use serde_json::{json, Value};
    // Cross-service objective reads are confined to this privileged read-only RPC.
    fn foreign<R: TableRecord, T: Table<R>>() -> T {
        let prefix = (T::SERVICE, T::TABLE_INDEX).to_key();
        T::from_handle(KvHandle::open_direct(R::DB, &prefix, KvMode::Read))
    }
    fn parameter<'a>(query: &'a str, key: &str) -> Option<&'a str> {
        query.split('&').find_map(|p| {
            let (k, v) = p.split_once('=')?;
            (k == key).then_some(v)
        })
    }
    fn reply(status: u16, body: Value) -> Option<HttpReply> {
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
    #[action]
    fn serveSys(
        request: HttpRequest,
        _socket: Option<i32>,
        _user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        assert_eq!(
            get_sender(),
            psibase::services::http_server::SERVICE,
            "Native HTTP server required"
        );
        let (path, query) = request
            .target
            .split_once('?')
            .unwrap_or((&request.target, ""));
        if request.method == "GET" {
            if let Some(reply) = crate::explorer::serve(path, query) {
                return Some(reply);
            }
            if path == "/header" {
                let height = parameter(query, "height").and_then(|v| v.parse::<u32>().ok());
                let row = height
                    .and_then(|h| {
                        foreign::<_, btcrelay::CanonicalTable>()
                            .get_index_pk()
                            .get(&h)
                    })
                    .and_then(|r| {
                        foreign::<_, btcrelay::HeaderTable>()
                            .get_index_pk()
                            .get(&r.id)
                    });
                return reply(200, json!(row));
            }
            if path == "/outpoint" {
                let Some(txid) = parameter(query, "txid") else {
                    return reply(400, json!({"error":"Missing txid"}));
                };
                let Some(vout) = parameter(query, "vout").and_then(|v| v.parse::<u32>().ok())
                else {
                    return reply(400, json!({"error":"Invalid vout"}));
                };
                if txid.len() != 64 || !txid.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return reply(400, json!({"error":"Invalid txid"}));
                }
                return reply(
                    200,
                    json!(UtxoTable::read().get_index_pk().get(&format!(
                        "{}:{:08x}",
                        txid.to_lowercase(),
                        vout
                    ))),
                );
            }
            if path == "/addresses" {
                let after = parameter(query, "after").unwrap_or("0").parse::<u32>();
                let limit = parameter(query, "limit").unwrap_or("200").parse::<usize>();
                let (Ok(after), Ok(limit)) = (after, limit) else {
                    return reply(400, json!({"error":"Invalid cursor"}));
                };
                if !(1..=200).contains(&limit) {
                    return reply(400, json!({"error":"Page size limit"}));
                }
                let rows: Vec<_> = AddressTable::read()
                    .get_index_pk()
                    .range(after..)
                    .take(limit + 1)
                    .collect();
                let next = rows.get(limit).map(|r| r.index);
                return reply(
                    200,
                    json!({"addresses":rows.iter().take(limit).collect::<Vec<_>>(),"next":next}),
                );
            }
            if path == "/snapshot" {
                let config = ConfigTable::read().get_index_pk().get(&());
                let relay = foreign::<_, btcrelay::RelayTable>().get_index_pk().get(&());
                let owner = parameter(query, "owner").and_then(|s| s.parse::<AccountNumber>().ok());
                if parameter(query, "owner").is_some() && owner.is_none() {
                    return reply(400, json!({"error":"Invalid account"}));
                }
                let addresses: Vec<_> = if let Some(owner) = owner {
                    AddressTable::read()
                        .get_index_by_owner()
                        .range(..=(owner, u32::MAX))
                        .rev()
                        .take_while(|a| a.owner == owner)
                        .take(100)
                        .collect()
                } else {
                    AddressTable::read()
                        .get_index_pk()
                        .iter()
                        .take(200)
                        .collect()
                };
                let active: Vec<_> = BatchTable::read()
                    .get_index_by_status()
                    .range((0, 0)..=(0, u32::MAX))
                    .take(16)
                    .collect();
                let mut batches = active.clone();
                batches.extend(
                    BatchTable::read()
                        .get_index_by_status()
                        .range((1, 0)..=(1, u32::MAX))
                        .rev()
                        .take(32),
                );
                let mut revisions = vec![];
                let mut signatures = vec![];
                let mut signing_links = vec![];
                let mut hash_requests = vec![];
                let mut requests = std::collections::BTreeMap::new();
                let mut utxos = std::collections::BTreeMap::new();
                for b in &active {
                    for id in &b.requests {
                        if let Some(r) = RequestTable::read().get_index_pk().get(id) {
                            requests.insert(r.id, r);
                        }
                    }
                    for rev in 0..=b.current_revision {
                        let r = RevisionTable::read()
                            .get_index_pk()
                            .get(&(b.id, rev))
                            .unwrap();
                        let plan: btcbridge_core::Plan = serde_json::from_str(&r.plan).unwrap();
                        for i in &plan.inputs {
                            if let Some(u) = UtxoTable::read().get_index_pk().get(&i.id()) {
                                utxos.insert(u.id.clone(), u);
                            }
                        }
                        for link in SigningLinkTable::read()
                            .get_index_pk()
                            .range((b.id, rev, 0, 0)..=(b.id, rev, 2, u32::MAX))
                        {
                            hash_requests.push(
                                foreign::<_, signing::HashRequestTable>()
                                    .get_index_pk()
                                    .get(&link.request)
                                    .unwrap(),
                            );
                            signing_links.push(link);
                        }
                        signatures.extend(
                            SignatureTable::read()
                                .get_index_pk()
                                .range((b.id, rev, 0)..=(b.id, rev, 2)),
                        );
                        revisions.push(r);
                    }
                }
                for r in RequestTable::read()
                    .get_index_by_status()
                    .range((0, 0)..=(0, u64::MAX))
                    .take(256)
                {
                    requests.insert(r.id, r);
                }
                if let Some(owner) = owner {
                    for r in RequestTable::read()
                        .get_index_by_owner()
                        .range((owner, 0)..=(owner, u64::MAX))
                        .rev()
                        .take(100)
                    {
                        requests.insert(r.id, r);
                    }
                }
                for u in UtxoTable::read()
                    .get_index_by_status()
                    .range((0, 0, String::new())..=(0, u32::MAX, "z".into()))
                    .take(256)
                {
                    utxos.insert(u.id.clone(), u);
                }
                let block = psibase::services::transact::Wrapper::call().currentBlock();
                let policy = config
                    .as_ref()
                    .map(|c| serde_json::from_str::<Value>(&c.policy).unwrap());
                let token = config.as_ref().and_then(|c| {
                    foreign::<_, tokens::tables::tables::TokenTable>()
                        .get_index_pk()
                        .get(&c.token)
                });
                let wallet = owner.zip(config.as_ref()).map(|(owner, c)| {
                    let balance = foreign::<_, tokens::tables::tables::BalanceTable>()
                        .get_index_pk()
                        .get(&(owner, c.token))
                        .map(|b| b.balance.value)
                        .unwrap_or(0);
                    let incoming = foreign::<_, tokens::tables::tables::SharedBalanceTable>()
                        .get_index_by_creditor_debitor_token()
                        .get(&(btcbridge::SERVICE, owner, c.token))
                        .map(|b| b.balance.value)
                        .unwrap_or(0);
                    json!({"balance":balance,"incoming":incoming})
                });
                let tip_header = relay.as_ref().and_then(|c| {
                    foreign::<_, btcrelay::HeaderTable>()
                        .get_index_pk()
                        .get(&c.tip)
                });
                return reply(
                    200,
                    json!({"config":config,"policy":policy,"relay":relay,"tip_header":tip_header,"token":token,"wallet":wallet,
                    "deposit_fee_terms":btcbridge::deposit_fees(block.time.floor::<psibase::psio::time::Seconds>().ticks() as u64),"deposit_fee_policy":btcbridge::DepositFeesTable::read().get_index_pk().get(&()),
                    "block_num":block.blockNum,"commit_num":block.commitNum,"now":block.time.floor::<psibase::psio::time::Seconds>().ticks(),
                    "addresses":addresses,"requests":requests.values().collect::<Vec<_>>(),"batches":batches,"revisions":revisions,
                    "signatures":signatures,"signing_links":signing_links,"hash_requests":hash_requests,"custody_keys":CustodyKeyTable::read().get_index_pk().iter().collect::<Vec<_>>(),"utxos":utxos.values().collect::<Vec<_>>(),"utxo_page_limit":256,"request_page_limit":256}),
                );
            }
        }
        serve_action_templates::<btcbridge::Wrapper>(&request)
            .or_else(|| serve_pack_action::<btcbridge::Wrapper>(&request))
    }
}
