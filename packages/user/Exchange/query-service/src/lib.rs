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
                "/snapshot" => {
                    let Some(owner) = user else {
                        return reply(
                            403,
                            "{\"error\":\"authenticated native user required\"}".into(),
                            true,
                        );
                    };
                    if parameter(query, "owner")
                        .map(|requested| requested != owner.to_string())
                        .unwrap_or(false)
                    {
                        return reply(403, "{\"error\":\"snapshot owner authority\"}".into(), true);
                    }
                    return reply(200, exchange::snapshot::read(owner), true);
                }
                "/markets" => return reply(200, exchange::snapshot::read_public(), false),
                "/tokens" => {
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
        serve_simple_ui::<exchange::Wrapper>(&request)
    }
}
