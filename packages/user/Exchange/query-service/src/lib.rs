#[psibase::service(name = "exchange+1")]
#[allow(non_snake_case)]
pub mod service {
    use psibase::*;
    fn json_reply(status: u16, body: String, private: bool) -> Option<HttpReply> {
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
    // Native Host performs authenticated requests from the Supervisor origin.
    // Match the full origin (including the development port), never a suffix
    // or arbitrary sibling app. CORS is not a substitute for owner authority.
    fn supervisor_cors(request: &HttpRequest, socket: Option<i32>) -> Vec<HttpHeader> {
        let Some(origin) = request.get_header("origin") else {
            return vec![];
        };
        let http = psibase::services::http_server::Wrapper::call();
        let root = http.rootHost(request.host.clone());
        let local = root == "localhost" || root.ends_with(".localhost");
        // Native request.host excludes the port; the original Host header and
        // socket/proxy protocol are handled by the platform URL constructor.
        let sibling = http.getSiblingUrl(request.clone(), socket, account!("supervisor"), false);
        let expected = sibling.trim_end_matches('/');
        let allowed = origin == expected && (origin.starts_with("https://") || local);
        if !allowed {
            return vec![];
        }
        vec![
            HttpHeader::new("Access-Control-Allow-Origin", origin),
            HttpHeader::new("Access-Control-Allow-Credentials", "true"),
            HttpHeader::new("Access-Control-Allow-Methods", "GET, OPTIONS"),
            HttpHeader::new(
                "Access-Control-Allow-Headers",
                "Authorization, Content-Type, Accept",
            ),
            HttpHeader::new("Vary", "Origin"),
        ]
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
    fn optional_decimal<T: std::str::FromStr>(
        query: &str,
        name: &str,
    ) -> Result<Option<T>, String> {
        parameter(query, name)
            .map(|s| decimal(s).ok_or_else(|| format!("Invalid {name}")))
            .transpose()
    }
    fn required_decimal<T: std::str::FromStr>(query: &str, name: &str) -> Result<T, String> {
        optional_decimal(query, name)?.ok_or_else(|| format!("Missing {name}"))
    }
    fn page_limit(query: &str) -> Result<u32, String> {
        let n = optional_decimal(query, "limit")?.unwrap_or(100);
        if (1..=200).contains(&n) {
            Ok(n)
        } else {
            Err("Page limit must be 1 to 200".into())
        }
    }
    fn optional_bool(query: &str, name: &str) -> Result<Option<bool>, String> {
        parameter(query, name)
            .map(|s| match s {
                "true" => Ok(true),
                "false" => Ok(false),
                _ => Err(format!("Invalid {name}")),
            })
            .transpose()
    }
    fn position_side(query: &str, kind: &str) -> Result<Option<bool>, String> {
        let alias = match kind {
            "orders" => "bid",
            "loans" => "long",
            "lenders" => "base",
            _ => "side",
        };
        let side = optional_bool(query, "side")?;
        let other = optional_bool(query, alias)?;
        if side.is_some() && other.is_some() && side != other {
            return Err("Conflicting position side".into());
        }
        Ok(side.or(other))
    }
    fn private_path(path: &str) -> bool {
        matches!(
            path,
            "/snapshot"
                | "/api/state"
                | "/stop"
                | "/api/stop"
                | "/stops"
                | "/api/stops"
                | "/positions"
                | "/api/positions"
                | "/position"
                | "/api/position"
                | "/assets"
                | "/api/assets"
                | "/asset"
                | "/api/asset"
                | "/funding"
                | "/api/funding"
        )
    }
    fn paged_path(path: &str) -> bool {
        private_path(path)
            || matches!(
                path,
                "/markets" | "/api/markets" | "/market" | "/api/market" | "/book" | "/api/book"
            )
    }
    #[action]
    fn serveSys(
        request: HttpRequest,
        socket: Option<i32>,
        user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        assert_eq!(
            get_sender(),
            psibase::services::http_server::SERVICE,
            "exchange::serveSys requires the native HTTP server"
        );
        let target = request.target.to_str().unwrap_or_default();
        let (path, query) = target.split_once('?').unwrap_or((target, ""));
        let cors = supervisor_cors(&request, socket);
        let reply = |status, body, private| {
            json_reply(status, body, private).map(|mut response| {
                response.headers.extend(cors.clone());
                response
            })
        };
        if private_path(path) {
            let root =
                psibase::services::http_server::Wrapper::call().rootHost(request.host.clone());
            if !request
                .host
                .eq_ignore_ascii_case(&format!("exchange.{root}"))
            {
                return reply(
                    403,
                    "{\"error\":\"private queries require the Exchange host\"}".into(),
                    true,
                );
            }
        }
        if request.method == "OPTIONS"
            && (paged_path(path)
                || matches!(
                    path,
                    "/snapshot"
                        | "/api/state"
                        | "/stop"
                        | "/api/stop"
                        | "/stops"
                        | "/api/stops"
                        | "/markets"
                        | "/api/markets"
                        | "/trades"
                        | "/api/trades"
                        | "/candles"
                        | "/api/candles"
                        | "/tokens"
                        | "/api/tokens"
                ))
        {
            return reply(204, String::new(), true);
        }
        if request.method == "GET" {
            if paged_path(path) {
                // Reject ambiguous duplicate parameters before either an authority
                // check or cursor parse. The native authenticated user selects owner.
                let mut names = std::collections::BTreeSet::new();
                for pair in query.split('&').filter(|p| !p.is_empty()) {
                    let Some((name, _)) = pair.split_once('=') else {
                        return reply(
                            400,
                            "{\"error\":\"invalid query parameter\"}".into(),
                            private_path(path),
                        );
                    };
                    if !names.insert(name) {
                        return reply(
                            400,
                            "{\"error\":\"duplicate query parameter\"}".into(),
                            private_path(path),
                        );
                    }
                }
                if private_path(path) {
                    let Some(owner) = user else {
                        return reply(
                            403,
                            "{\"error\":\"authenticated native user required\"}".into(),
                            true,
                        );
                    };
                    if ["owner", "account"]
                        .iter()
                        .any(|name| parameter(query, name).is_some_and(|s| s != owner.to_string()))
                    {
                        return reply(403, "{\"error\":\"owner authority\"}".into(), true);
                    }
                }
                let result: Option<Result<serde_json::Value, String>> = (|| {
                    let owner = user.unwrap_or_default();
                    Some(match path {
                        "/snapshot" | "/api/state" => (|| {
                            exchange::pages::snapshot(
                                owner,
                                optional_decimal(query, "market")?,
                                true,
                            )
                        })(),
                        "/markets" | "/api/markets" => (|| {
                            exchange::pages::markets(
                                optional_decimal(query, "after")?.unwrap_or(0),
                                page_limit(query)?,
                                true,
                            )
                        })(),
                        "/market" | "/api/market" => (|| {
                            exchange::pages::market_point(required_decimal(query, "market")?, true)
                        })(),
                        "/book" | "/api/book" => (|| {
                            exchange::pages::book(
                                required_decimal(query, "market")?,
                                optional_bool(query, "bid")?.ok_or("Missing bid")?,
                                parameter(query, "after"),
                                page_limit(query)?,
                            )
                        })(),
                        "/positions" | "/api/positions" => (|| {
                            exchange::pages::positions(
                                owner,
                                parameter(query, "kind").ok_or("Missing kind")?,
                                optional_decimal(query, "market")?,
                                parameter(query, "after"),
                                page_limit(query)?,
                                true,
                            )
                        })(),
                        "/position" | "/api/position" => (|| {
                            exchange::pages::position(
                                owner,
                                parameter(query, "kind").ok_or("Missing kind")?,
                                required_decimal(query, "market")?,
                                position_side(
                                    query,
                                    parameter(query, "kind").ok_or("Missing kind")?,
                                )?,
                                optional_decimal(query, "price")?,
                                true,
                            )
                        })(),
                        "/assets" | "/api/assets" => (|| {
                            exchange::pages::assets(
                                owner,
                                parameter(query, "after"),
                                page_limit(query)?,
                            )
                        })(),
                        "/asset" | "/api/asset" => {
                            (|| exchange::pages::asset(owner, required_decimal(query, "token")?))()
                        }
                        "/funding" | "/api/funding" => (|| {
                            let ids: Result<Vec<u32>, String> = parameter(query, "tokens")
                                .ok_or("Missing tokens")?
                                .split(',')
                                .take(17)
                                .map(|s| decimal(s).ok_or_else(|| "Invalid funding token".into()))
                                .collect();
                            exchange::pages::funding(
                                owner,
                                &ids?,
                                parameter(query, "after"),
                                page_limit(query)?,
                            )
                        })(),
                        _ => return None,
                    })
                })();
                if let Some(result) = result {
                    return match result {
                        Ok(page) => reply(200, exchange::pages::text(page), private_path(path)),
                        Err(error) => reply(
                            if error == "Unknown market" || error == "Unknown token" {
                                404
                            } else {
                                400
                            },
                            serde_json::json!({"error":error}).to_string(),
                            private_path(path),
                        ),
                    };
                }
            }
            match path {
                "/stop" | "/api/stop" | "/stops" | "/api/stops" => {
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
                        return reply(
                            403,
                            "{\"error\":\"stop position owner authority\"}".into(),
                            true,
                        );
                    }
                    if path == "/stop" || path == "/api/stop" {
                        let Some(generation) =
                            parameter(query, "generation").and_then(decimal::<u64>)
                        else {
                            return reply(
                                400,
                                "{\"error\":\"invalid stop generation\"}".into(),
                                true,
                            );
                        };
                        return reply(200, exchange::snapshot::read_stop(owner, generation), true);
                    }
                    let limit = decimal::<u32>(parameter(query, "limit").unwrap_or("100"));
                    let before = parameter(query, "before").map(decimal::<u64>);
                    let Some(limit) = limit else {
                        return reply(400, "{\"error\":\"invalid stop page\"}".into(), true);
                    };
                    if !(1..=200).contains(&limit) || before == Some(None) {
                        return reply(400, "{\"error\":\"invalid stop page\"}".into(), true);
                    }
                    return reply(
                        200,
                        exchange::snapshot::read_stops(owner, before.flatten(), limit),
                        true,
                    );
                }
                "/candles" | "/api/candles" => {
                    let market = parameter(query, "market").and_then(decimal::<u64>);
                    let interval = decimal::<u32>(parameter(query, "interval").unwrap_or("60"));
                    let limit = decimal::<u32>(parameter(query, "limit").unwrap_or("100"));
                    let before = parameter(query, "before").map(decimal::<u64>);
                    let (Some(market), Some(interval), Some(limit)) = (market, interval, limit)
                    else {
                        return reply(
                            400,
                            "{\"error\":\"invalid candle parameters\"}".into(),
                            false,
                        );
                    };
                    if market == 0
                        || limit == 0
                        || limit > exchange::candles::MAX_PAGE
                        || !exchange::candles::INTERVALS.contains(&interval)
                        || before == Some(None)
                    {
                        return reply(
                            400,
                            "{\"error\":\"invalid candle parameters\"}".into(),
                            false,
                        );
                    }
                    return match exchange::candles::read(market, interval, limit, before.flatten())
                    {
                        Ok(body) => reply(200, body, false),
                        Err(error) => {
                            reply(503, serde_json::json!({"error":error}).to_string(), false)
                        }
                    };
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
