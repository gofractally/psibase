use super::*;
use psibase::fracpack::{Pack, ToSchema, Unpack};

#[derive(Pack, Unpack, ToSchema, serde::Serialize, serde::Deserialize)]
#[fracpack(fracpack_mod = "psibase::fracpack")]
#[allow(dead_code)]
struct Credit {
    token_id: u32,
    debitor: AccountNumber,
    amount: u64,
    memo: String,
}

struct Fake;
fn tokens_schema() -> Schema {
    let u = |bits: u32| json!({"Int": {"bits": bits, "isSigned": false}});
    serde_json::from_value(json!({
        "service": "tokens",
        "types": {
            "AccountNumber": {"Custom": {"type": u(64), "id": "AccountNumber"}},
            "string": {"Custom": {"type": {"List": u(8)}, "id": "string"}},
        },
        "actions": {
            "credit": {"params": {"Object": {"token_id": u(32), "debitor": "AccountNumber", "amount": u(64), "memo": "string"}}, "result": null},
            "serveSys": {"params": {"Object": {}}, "result": null},
        },
        "history": {}, "merkle": {}
    }))
    .unwrap()
}
impl ChainView for Fake {
    fn packages(&self) -> Vec<PackageInfo> {
        vec![PackageInfo {
            name: "Tokens".into(),
            description: "tokens".into(),
            services: vec![AccountNumber::from_exact("tokens").unwrap()],
        }]
    }
    fn schema(&self, s: AccountNumber) -> Option<Schema> {
        (s.to_string() == "tokens").then(tokens_schema)
    }
}

fn post<'a>(
    body: &'a str,
    ver: Option<&'a str>,
    mm: Option<&'a str>,
    mn: Option<&'a str>,
) -> Req<'a> {
    Req {
        method: "POST",
        origin: None,
        root_host: "psibase.localhost:8080",
        protocol_version: ver,
        mcp_method: mm,
        mcp_name: mn,
        body: body.as_bytes(),
    }
}

#[test]
fn get_is_405_and_any_origin_ok() {
    let mut r = post("{}", None, None, None);
    r.method = "GET";
    assert_eq!(handle(&r, &Fake).status, 405);
    let mut r = post(
        r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#,
        None,
        None,
        None,
    );
    r.origin = Some("https://evil.example");
    assert_eq!(handle(&r, &Fake).status, 200);
    r.origin = Some("vscode-file://vscode-app");
    assert_eq!(handle(&r, &Fake).status, 200);
}

#[test]
fn initialize_2025_and_notification() {
    let r = handle(
        &post(
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}"#,
            None,
            None,
            None,
        ),
        &Fake,
    );
    let body = r.body.unwrap();
    assert_eq!(body["result"]["protocolVersion"], "2025-06-18");
    let instructions = body["result"]["instructions"].as_str().unwrap();
    assert!(instructions.contains("Node: psibase.localhost:8080"));
    assert!(instructions.contains("mcp.psibase.localhost:8080/agent.html"));
    assert!(instructions.contains("mcp.psibase.localhost:8080/agent.txt"));
    assert!(instructions.find("agent.html") < instructions.find("psibase push"));
    assert!(r.headers.iter().any(|h| h.0 == "Mcp-Session-Id"));
    let r = handle(
        &post(
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
            Some("2025-06-18"),
            None,
            None,
        ),
        &Fake,
    );
    assert_eq!(r.status, 202);
}

#[test]
fn v2026_requires_matching_headers() {
    let body = r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{"_meta":{"protocolVersion":"2026-07-28"}}}"#;
    assert_eq!(
        handle(&post(body, Some(V2026), None, None), &Fake).status,
        400
    );
    assert_eq!(
        handle(&post(body, Some(V2026), Some("tools/call"), None), &Fake).status,
        400
    );
    let r = handle(&post(body, Some(V2026), Some("tools/list"), None), &Fake);
    assert_eq!(r.status, 200);
    assert_eq!(
        r.body.unwrap()["result"]["tools"].as_array().unwrap().len(),
        3
    );
    let call =
        r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_services"}}"#;
    assert_eq!(
        handle(&post(call, Some(V2026), Some("tools/call"), None), &Fake).status,
        400
    );
    assert_eq!(
        handle(
            &post(call, Some(V2026), Some("tools/call"), Some("list_services")),
            &Fake
        )
        .status,
        200
    );
    let d = r#"{"jsonrpc":"2.0","id":4,"method":"server/discover","params":{"_meta":{"protocolVersion":"2026-07-28"}}}"#;
    let r = handle(&post(d, Some(V2026), Some("server/discover"), None), &Fake);
    assert!(r.body.unwrap()["result"]["supportedVersions"][0] == V2026);
}

#[test]
fn describe_drops_http_handlers() {
    let v = call_tool("describe_service", &json!({"service": "tokens"}), &Fake).unwrap();
    let tools = v["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0]["name"], "tokens.credit");
    assert_eq!(
        tools[0]["inputSchema"]["properties"]["debitor"]["type"],
        "string"
    );
}

#[test]
fn build_transaction_json_matches_packed() {
    let args = json!({"actions": [{"sender": "alice", "service": "tokens", "method": "credit",
        "data": {"token_id": 1, "debitor": "bob", "amount": "100", "memo": "hi"}}]});
    let v = build_transaction(&args, &Fake).unwrap();
    let a = &v["transaction"]["actions"][0];
    assert_eq!(a["data"]["debitor"], "bob");
    // Repack from the JSON and compare to the packed bytes, as a client would.
    let raw = Credit {
        token_id: 1,
        debitor: AccountNumber::from_exact("bob").unwrap(),
        amount: 100,
        memo: "hi".into(),
    }
    .packed();
    assert_eq!(a["rawData"], Hex(raw.clone()).to_string());
    let tx: Transaction = serde_json::from_value(json!({
        "tapos": v["transaction"]["tapos"],
        "actions": [{"sender": "alice", "service": "tokens", "method": "credit", "rawData": Hex(raw).to_string()}],
        "claims": []
    })).unwrap();
    assert_eq!(v["packed"], Hex(tx.packed()).to_string());
    // Bad args are rejected
    assert!(build_transaction(&json!({"actions": [{"sender": "alice", "service": "tokens", "method": "nope", "data": {}}]}), &Fake).is_err());
    assert!(build_transaction(&json!({"actions": [{"sender": "alice", "service": "tokens", "method": "serveSys", "data": {}}]}), &Fake).is_err());
}

#[test]
fn build_transaction_propose_wraps() {
    let args = json!({"actions": [{"sender": "alice", "service": "tokens", "method": "credit",
        "data": {"token_id": 1, "debitor": "bob", "amount": "1", "memo": ""}}],
        "propose": {"proposer": "agent"}});
    let v = build_transaction(&args, &Fake).unwrap();
    let a = &v["transaction"]["actions"][0];
    assert_eq!(a["service"], "staged-tx");
    assert_eq!(a["sender"], "agent");
    assert_eq!(a["data"]["actions"][0]["sender"], "alice");
}
