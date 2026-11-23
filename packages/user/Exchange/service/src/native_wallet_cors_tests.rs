//! The real read service must work from native Supervisor without allowing
//! sibling apps to read private data or weakening the native owner checks.
use super::*;
use psibase::services::http_server;

#[psibase::test_case(packages("Exchange"))]
fn native_supervisor_cors_preserves_owner_authority(chain: Chain) -> Result<(), Error> {
    setup(&chain, true)?;
    let token = chain.login(account!("alice"), crate::SERVICE)?;
    let call = |origin: &str, method: &str, target: &str, user| {
        let mut headers = vec![HttpHeader::new("Origin", origin),
            HttpHeader::new("X-Forwarded-Proto", "https")];
        if user == Some(account!("alice")) {
            headers.push(HttpHeader::new("Authorization", &format!("Bearer {token}")));
        }
        chain.http(&HttpRequest {
                host: "exchange.psibase.io".into(),
                method: method.into(), target: target.into(),
                headers,
                ..Default::default()
            }).unwrap()
    };
    let header = |r: &HttpReply, name: &str| r.headers.iter()
        .find(|h| h.name.eq_ignore_ascii_case(name)).map(|h| h.value.to_string());
    let supervisor = "https://supervisor.psibase.io";
    let preflight = call(supervisor, "OPTIONS", "/snapshot", None);
    assert_eq!(preflight.status, 204);
    assert_eq!(header(&preflight, "Access-Control-Allow-Origin").as_deref(), Some(supervisor));
    assert_eq!(header(&preflight, "Access-Control-Allow-Credentials").as_deref(), Some("true"));
    assert!(header(&preflight, "Access-Control-Allow-Headers").unwrap().contains("Authorization"));
    let private = call(supervisor, "GET", "/snapshot", Some(account!("alice")));
    assert_eq!(private.status, 200);
    assert_eq!(header(&private, "Cache-Control").as_deref(), Some("no-store"));
    let body: Value = serde_json::from_slice(&private.body)?;
    assert_eq!(body["owner"], "alice");
    assert_eq!(call(supervisor, "GET", "/snapshot?owner=bob", Some(account!("alice"))).status, 403);
    assert_eq!(call(supervisor, "GET", "/snapshot", None).status, 403);
    for foreign in ["https://otherapp.psibase.io", "https://supervisor.psibase.io.other", "https://supervisor.psibase.io:8090"] {
        for method in ["GET", "OPTIONS"] {
            let response = call(foreign, method, "/snapshot", None);
            assert!(header(&response, "Access-Control-Allow-Origin").is_none());
            assert!(header(&response, "Access-Control-Allow-Credentials").is_none());
        }
    }
    audit(&chain);
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn native_private_queries_require_the_exchange_host(chain: Chain) -> Result<(), Error> {
    setup(&chain, true)?;
    let alias = account!("queryalias");
    chain.new_account(alias)?;
    http_server::Wrapper::push_from(&chain, alias)
        .registerServer(exchange_pkg::r_exchange::SERVICE).get()?;
    let token = chain.login(account!("alice"), crate::SERVICE)?;
    let own = chain.get_auth(crate::SERVICE, "/snapshot", &token)?;
    assert_eq!(own.status, 200);
    for path in ["/snapshot", "/api/state", "/stops", "/stop?generation=1"] {
        assert_eq!(chain.get_auth(alias, path, &token)?.status, 403);
    }
    assert_eq!(chain.get(alias, "/markets")?.status, 200);
    // The Tokens reader supports public metadata even when reused, while
    // private balances still require its own canonical application host.
    http_server::Wrapper::push_from(&chain, alias)
        .registerServer(account!("tokens+1")).get()?;
    let own_query = "{userBalance(user:\"alice\",tokenId:\"1\"){account balance}}";
    let own: Value = chain.graphql_auth(tokens::SERVICE, own_query, &token)?;
    assert_eq!(own["data"]["userBalance"]["account"], "alice");
    assert!(own["errors"].is_null());
    for (host, query) in [(alias, own_query), (tokens::SERVICE,
        "{userBalance(user:\"bob\",tokenId:\"1\"){account balance}}") ] {
        let denied: Value = chain.graphql_auth(host, query, &token)?;
        assert!(denied["errors"].as_array().is_some_and(|e| !e.is_empty()));
        assert!(denied["data"]["userBalance"].is_null());
    }
    let public: Value = chain.graphql(alias, "{token(tokenId:\"1\"){id precision owner}}")?;
    assert!(public["data"]["token"].is_object());
    audit(&chain);
    Ok(())
}
