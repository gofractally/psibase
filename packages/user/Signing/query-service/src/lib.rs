#[psibase::service(name = "signhash+1")]
#[allow(non_snake_case)]
pub mod service {
    use psibase::*;
    use signing::{HashRequestTable, KeyTable, PendingKeyTable, SigningConfigTable};
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
        if request.method == "GET" && request.target.starts_with("/snapshot?provider=") {
            let provider: AccountNumber = request
                .target
                .strip_prefix("/snapshot?provider=")?
                .parse()
                .ok()?;
            let block = psibase::services::transact::Wrapper::call().currentBlock();
            let requests: Vec<_> = HashRequestTable::read()
                .get_index_by_pending()
                .range((provider, false, 0)..=(provider, false, u64::MAX))
                .take(256)
                .collect();
            let mut keys = std::collections::BTreeMap::new();
            for pending in PendingKeyTable::read()
                .get_index_by_provider()
                .range((provider, 0)..=(provider, u32::MAX))
                .take(256)
            {
                if let Some(key) = KeyTable::read().get_index_pk().get(&pending.id) {
                    keys.insert(key.id, key);
                }
            }
            for r in &requests {
                if let Some(key) = KeyTable::read().get_index_pk().get(&r.key) {
                    keys.insert(key.id, key);
                }
            }
            let body=serde_json::json!({"config":SigningConfigTable::read().get_index_pk().get(&()),"keys":keys.values().collect::<Vec<_>>(),"requests":requests,"block_num":block.blockNum,"commit_num":block.commitNum,"now":block.time.floor::<psibase::psio::time::Seconds>().ticks()}).to_string();
            return Some(HttpReply {
                status: 200,
                contentType: "application/json".into(),
                body: body.into_bytes().into(),
                headers: vec![HttpHeader {
                    name: "Cache-Control".into(),
                    value: "no-store".into(),
                }],
            });
        }
        serve_action_templates::<signing::Wrapper>(&request)
            .or_else(|| serve_pack_action::<signing::Wrapper>(&request))
    }
}
