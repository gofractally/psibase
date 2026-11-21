#[psibase::service(name = "exchange+1")]
#[allow(non_snake_case)]
pub mod service {
    use psibase::*;
    fn reply(status: u16, body: String, private: bool) -> Option<HttpReply> {
        Some(HttpReply {
            status,
            contentType: "application/json".into(),
            body: body.into_bytes().into(),
            headers: if private {
                vec![HttpHeader {
                    name: "Cache-Control".into(),
                    value: "no-store".into(),
                }]
            } else {
                vec![]
            },
        })
    }
    fn parameter<'a>(query: &'a str, name: &str) -> Option<&'a str> {
        query.split('&').find_map(|pair| {
            let (key, value) = pair.split_once('=')?;
            (key == name).then_some(value)
        })
    }
    fn decimal<T: std::str::FromStr>(value: &str) -> Option<T> {
        if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        value.parse().ok()
    }
    #[action]
    fn serveSys(
        request: HttpRequest,
        _socket: Option<i32>,
        user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        assert_eq!(
            get_sender(),
            psibase::services::http_server::SERVICE,
            "exchange::serveSys requires the native HTTP server"
        );
        let (path, query) = request
            .target
            .split_once('?')
            .unwrap_or((&request.target, ""));
        if request.method == "GET" {
            match path {
                "/stop" | "/api/stop" | "/stops" | "/api/stops" => {
                    let Some(owner) = user else {
                        return reply(403,"{\"error\":\"authenticated native user required\"}".into(),true);
                    };
                    if parameter(query,"owner").or_else(||parameter(query,"account"))
                        .map(|requested|requested!=owner.to_string()).unwrap_or(false) {
                        return reply(403,"{\"error\":\"stop position owner authority\"}".into(),true);
                    }
                    if path=="/stop" || path=="/api/stop" {
                        let Some(generation) = parameter(query,"generation").and_then(decimal::<u64>) else {
                            return reply(400,"{\"error\":\"invalid stop generation\"}".into(),true);
                        };
                        return reply(200,exchange::snapshot::read_stop(owner,generation),true);
                    }
                    let limit = decimal::<u32>(parameter(query,"limit").unwrap_or("100"));
                    let before = parameter(query,"before").map(decimal::<u64>);
                    let Some(limit) = limit else {
                        return reply(400,"{\"error\":\"invalid stop page\"}".into(),true);
                    };
                    if !(1..=200).contains(&limit) || before==Some(None) {
                        return reply(400,"{\"error\":\"invalid stop page\"}".into(),true);
                    }
                    return reply(200,exchange::snapshot::read_stops(owner,before.flatten(),limit),true);
                }
                "/snapshot" | "/api/state" => {
                    let Some(owner) = user else {
                        return reply(
                            403,
                            "{\"error\":\"authenticated native user required\"}".into(),
                            true,
                        );
                    };
                    if parameter(query, "owner")
                        .or_else(|| parameter(query, "account"))
                        .map(|requested| requested != owner.to_string())
                        .unwrap_or(false)
                    {
                        return reply(403, "{\"error\":\"snapshot owner authority\"}".into(), true);
                    }
                    return reply(200, exchange::snapshot::read(owner), true);
                }
                "/markets" | "/api/markets" => {
                    return reply(200, exchange::snapshot::read_public(), false)
                }
                "/trades" | "/api/trades" => {
                    let market = parameter(query, "market").and_then(decimal::<u64>);
                    let limit = decimal::<u32>(parameter(query, "limit").unwrap_or("50"));
                    let before = parameter(query, "before").map(decimal::<u64>);
                    let after = parameter(query, "after").map(decimal::<u64>);
                    let (Some(market), Some(limit)) = (market, limit) else {
                        return reply(
                            400,
                            "{\"error\":\"invalid trade cursor or market\"}".into(),
                            false,
                        );
                    };
                    let before = match before {
                        Some(Some(id)) => Some(id),
                        None => None,
                        _ => {
                            return reply(400, "{\"error\":\"invalid trade cursor\"}".into(), false)
                        }
                    };
                    let after = match after {
                        Some(Some(id)) => Some(id),
                        None => None,
                        _ => {
                            return reply(400, "{\"error\":\"invalid trade cursor\"}".into(), false)
                        }
                    };
                    if market == 0 || limit == 0 || limit > exchange::trades::MAX_PAGE {
                        return reply(
                            400,
                            "{\"error\":\"invalid trade market or page size\"}".into(),
                            false,
                        );
                    }
                    return match exchange::trades::read(market, limit, before, after) {
                        Ok(body) => reply(200, body, false),
                        Err(error) => {
                            reply(503, serde_json::json!({"error":error}).to_string(), false)
                        }
                    };
                }
                "/tokens" | "/api/tokens" => {
                    let after = parameter(query, "after").unwrap_or("0").parse::<u32>();
                    let limit = parameter(query, "limit").unwrap_or("200").parse::<u32>();
                    let (Ok(after), Ok(limit)) = (after, limit) else {
                        return reply(400, "{\"error\":\"invalid token cursor\"}".into(), false);
                    };
                    return reply(200, exchange::snapshot::token_catalog(after, limit), false);
                }
                _ => {}
            }
        }
        // Returning None delegates unhandled paths to native Sites, including
        // the account's uploaded index.html and hashed frontend assets.
        serve_action_templates::<exchange::Wrapper>(&request)
            .or_else(|| serve_pack_action::<exchange::Wrapper>(&request))
    }
}
