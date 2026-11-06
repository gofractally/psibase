//! Transport-independent MCP JSON-RPC handling for X-MCP. Pure: chain access
//! goes through [`ChainView`], so this is unit-tested natively.
use crate::jsonschema::to_json_schema;
use psibase::fracpack::{CompiledSchema, Pack};
use psibase::{
    schema_types, AccountNumber, Action, Hex, MethodNumber, MethodString, Schema, Tapos,
    TimePointSec,
    Transaction,
};
use serde_json::{json, Value};

pub const V2026: &str = "2026-07-28";
pub const V2025: [&str; 4] = ["2025-03-26", "2025-06-18", "2025-11-25", "2024-11-05"];
pub const LATEST_2025: &str = "2025-11-25";

pub struct PackageInfo {
    pub name: String,
    pub description: String,
    pub services: Vec<AccountNumber>,
}

/// Head-block TAPOS reference plus "now", as the live node sees it.
pub struct HeadTapos {
    pub ref_block_index: u8,
    pub ref_block_suffix: u32,
    /// Current time in seconds since the epoch.
    pub now_seconds: i64,
}

/// How long a server-filled TAPOS stays valid: long enough to paste the
/// result into the signing page and submit it. Only covers pushing this
/// transaction; the owner's later approve is a separate transaction.
pub const TAPOS_EXPIRATION_SECS: i64 = 120;

pub trait ChainView {
    fn packages(&self) -> Vec<PackageInfo>;
    fn schema(&self, service: AccountNumber) -> Option<Schema>;
    /// Same source as GET /common/tapos/head (Transact::headTapos) plus a clock.
    fn head_tapos(&self) -> HeadTapos;
}

/// An HTTP-level request after transport parsing.
pub struct Req<'a> {
    pub method: &'a str,
    pub origin: Option<&'a str>,
    pub root_host: &'a str,
    pub protocol_version: Option<&'a str>,
    pub mcp_method: Option<&'a str>,
    pub mcp_name: Option<&'a str>,
    pub body: &'a [u8],
}

#[derive(Debug, PartialEq)]
pub struct Resp {
    pub status: u16,
    pub body: Option<Value>,
    pub headers: Vec<(String, String)>,
}

fn resp(status: u16, body: Value) -> Resp {
    Resp {
        status,
        body: Some(body),
        headers: vec![],
    }
}

fn rpc_err(id: &Value, code: i64, msg: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": msg}})
}

/// Origin check. PoC: allow any Origin (cloud MCP / Grok Bot); use auth later.
pub fn origin_ok(_origin: Option<&str>, _root_host: &str) -> bool {
    true
}

pub fn handle(req: &Req, chain: &dyn ChainView) -> Resp {
    match req.method {
        "POST" => {}
        "GET" => {
            return Resp {
                status: 405,
                body: None,
                headers: vec![("Allow".into(), "POST".into())],
            }
        }
        _ => {
            return Resp {
                status: 405,
                body: None,
                headers: vec![("Allow".into(), "POST".into())],
            }
        }
    }
    if !origin_ok(req.origin, req.root_host) {
        return resp(403, rpc_err(&Value::Null, -32600, "origin not allowed"));
    }
    let msg: Value = match serde_json::from_slice(req.body) {
        Ok(v) => v,
        Err(_) => return resp(400, rpc_err(&Value::Null, -32700, "parse error")),
    };
    let Some(method) = msg.get("method").and_then(Value::as_str) else {
        // A response or garbage; we never send requests, so nothing to match.
        return Resp {
            status: 202,
            body: None,
            headers: vec![],
        };
    };
    let id = msg.get("id").cloned();
    let params = msg.get("params").cloned().unwrap_or(json!({}));

    // Revision: header, else params._meta.protocolVersion, else 2025 (initialize).
    let meta_ver = params
        .pointer("/_meta/protocolVersion")
        .and_then(Value::as_str);
    let version = req.protocol_version.or(meta_ver);
    if version == Some(V2026) {
        if let (Some(h), Some(m)) = (req.protocol_version, meta_ver) {
            if h != m {
                return resp(
                    400,
                    rpc_err(
                        id.as_ref().unwrap_or(&Value::Null),
                        -32600,
                        "MCP-Protocol-Version does not match _meta",
                    ),
                );
            }
        }
        if req.mcp_method != Some(method) {
            return resp(
                400,
                rpc_err(
                    id.as_ref().unwrap_or(&Value::Null),
                    -32600,
                    "Mcp-Method header missing or does not match body",
                ),
            );
        }
        if matches!(method, "tools/call" | "resources/read" | "prompts/get") {
            let name = params
                .get("name")
                .or(params.get("uri"))
                .and_then(Value::as_str);
            if req.mcp_name.is_none() || req.mcp_name != name {
                return resp(
                    400,
                    rpc_err(
                        id.as_ref().unwrap_or(&Value::Null),
                        -32600,
                        "Mcp-Name header missing or does not match body",
                    ),
                );
            }
        }
    } else if let Some(v) = version {
        if !V2025.contains(&v) {
            return resp(
                400,
                rpc_err(
                    id.as_ref().unwrap_or(&Value::Null),
                    -32600,
                    &format!("unsupported protocol version {v}"),
                ),
            );
        }
    }

    let Some(id) = id else {
        // Notification (e.g. notifications/initialized)
        return Resp {
            status: 202,
            body: None,
            headers: vec![],
        };
    };

    let result = match method {
        "initialize" => {
            let asked = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or(LATEST_2025);
            let v = if V2025.contains(&asked) {
                asked
            } else {
                LATEST_2025
            };
            let mut r = resp(
                200,
                ok(
                    &id,
                    json!({
                        "protocolVersion": v,
                        "capabilities": {"tools": {"listChanged": false}},
                        "serverInfo": server_info(),
                        "instructions": instructions(req.root_host),
                    }),
                ),
            );
            // Thin 2025 compatibility shim: stateless, so the id carries no state.
            r.headers
                .push(("Mcp-Session-Id".into(), "x-mcp-stateless".into()));
            return r;
        }
        "server/discover" => Ok(json!({
            "supportedVersions": [V2026, "2025-11-25", "2025-06-18", "2025-03-26"],
            "capabilities": {"tools": {}},
            "serverInfo": server_info(),
            "instructions": instructions(req.root_host),
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": meta_tools() })),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            Ok(match call_tool(name, &args, chain) {
                Ok(v) => json!({
                    "content": [{"type": "text", "text": v.to_string()}],
                    "structuredContent": v,
                    "isError": false
                }),
                Err(e) => json!({"content": [{"type": "text", "text": e}], "isError": true}),
            })
        }
        _ => Err((-32601, format!("method not found: {method}"))),
    };
    match result {
        Ok(v) => resp(200, ok(&id, v)),
        Err((c, m)) => resp(200, rpc_err(&id, c, &m)),
    }
}

fn ok(id: &Value, result: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "result": result})
}

fn server_info() -> Value {
    json!({"name": "x-mcp", "title": "X-MCP (psibase)", "version": env!("CARGO_PKG_VERSION")})
}

fn instructions(root_host: &str) -> String {
    format!(
        "X-MCP describes on-chain psibase services and builds unsigned transactions. \
It never signs or pushes.

Node: {root_host}, over the same scheme and port you used to reach this server. \
\"The node\" below means this URL; other hosts below use the same scheme and port.

Build: list_services, then describe_service, then build_transaction. \
Omit `tapos`: X-MCP fills it from the node's head block and sets expiration to about \
2 minutes from now, so sign and submit promptly (rebuild if it expires). The result is for \
review and for pasting into the signing page below.

Token amounts: a Quantity is a scaled integer, the human amount times 10^precision of \
that token. Ten tokens at precision 4 is 100000, not 10. X-MCP packs whatever integer it \
is given and never converts decimals. To find the system token, make two separate POSTs to \
tokens.{root_host}/graphql:
1. {{ config {{ sysTid }} }} returns the system token id.
2. {{ token(tokenId: \"<that id>\") {{ precision id symbol }} }} (tokenId is a string) \
returns its precision (0-8) and symbol.
Then pass round(amount * 10^precision) as the Quantity, e.g. amount: {{ value: 100000 }} \
or the bare integer, as describe_service's schema for tokens.credit and similar shows.

Submit: signing happens with your own key, never through X-MCP.
- Signing page (default, needs only a browser): mcp.{root_host}/agent.html. \
Open it with ?agent=<your account>&owner=<account you act for>&actions=<url-encoded \
build_transaction result>, paste your private key, click #btn-import then #btn-propose, \
and read #result (JSON: executed, or stagedId when the owner must approve). \
Full element contract: mcp.{root_host}/agent.txt.
- psibase CLI (only if you have it): save the actions you passed to build_transaction \
as a JSON array file and run `psibase push -a <node URL> <file> -s <PEM key file> \
--proposer <your account>`.

Acting for the user's account (the owner): keep that account as each action's sender; you are \
the proposer. The transaction is staged. It runs at once if the owner allowlisted that method \
for you; otherwise it waits for the owner to approve in mcp.{root_host}/."
    )
}

pub fn meta_tools() -> Value {
    json!([
        {"name": "list_services", "description": "List installed packages and their service accounts.",
         "inputSchema": {"type": "object", "properties": {}}, "annotations": {"readOnlyHint": true}},
        {"name": "describe_service", "description": "List the transaction actions (tools) of one service account, each with a JSON Schema for its arguments.",
         "inputSchema": {"type": "object", "properties": {"service": {"type": "string"}}, "required": ["service"]},
         "annotations": {"readOnlyHint": true}},
        {"name": "build_transaction",
         "description": "Pack a list of actions into one unsigned transaction. TAPOS is filled by the server (head block reference, expiration about 2 minutes from now) unless overridden. Token amounts (Quantity) are scaled integers: human amount times 10^precision (10 tokens at precision 4 = 100000); X-MCP packs integers as given and never converts decimals; see the server instructions for the two tokens GraphQL queries that give the system token id and precision. Returns agent-readable JSON (TAPOS + each action's sender, service, method, decoded data) and the packed bytes (hex) of the same transaction. If `propose` is given, the actions are wrapped in a staged-tx propose action sent by the proposer. Never signs or pushes.",
         "inputSchema": {"type": "object", "required": ["actions"], "properties": {
            "actions": {"type": "array", "items": {"type": "object", "required": ["sender","service","method","data"],
                "properties": {"sender": {"type":"string"}, "service": {"type":"string"}, "method": {"type":"string"}, "data": {"type":"object"}}}},
            "tapos": {"type": "object", "description": "Optional; omit it and the server fills it. Override only for tests or unusual delays: {refBlockIndex, refBlockSuffix, expiration, flags}. If only the head reference is given, the server fills expiration."},
            "propose": {"type": "object", "properties": {"proposer": {"type":"string"}, "autoExec": {"type":"boolean"}}, "required": ["proposer"]}
         }},
         "annotations": {"readOnlyHint": true}}
    ])
}

fn acct(v: &Value, field: &str) -> Result<AccountNumber, String> {
    let s = v
        .get(field)
        .and_then(Value::as_str)
        .ok_or(format!("missing {field}"))?;
    AccountNumber::from_exact(s).map_err(|e| format!("bad {field} '{s}': {e}"))
}

/// Methods that are HTTP/system handlers, not transaction tools.
pub fn is_tool_method(name: &str) -> bool {
    !(name.starts_with('#') || name == "serveSys" || name.ends_with("Sys"))
}

pub fn call_tool(name: &str, args: &Value, chain: &dyn ChainView) -> Result<Value, String> {
    match name {
        "list_services" => Ok(json!({"packages": chain.packages().iter().map(|p| json!({
            "package": p.name, "description": p.description,
            "services": p.services.iter().map(|s| s.to_string()).collect::<Vec<_>>()
        })).collect::<Vec<_>>()})),
        "describe_service" => {
            let service = acct(args, "service")?;
            let schema = chain
                .schema(service)
                .ok_or(format!("no schema for {service}"))?;
            let tools: Vec<Value> = schema
                .actions
                .iter()
                .filter(|(m, _)| is_tool_method(&m.0))
                .map(|(m, f)| {
                    json!({
                        "name": format!("{service}.{}", m.0),
                        "service": service.to_string(),
                        "method": m.0,
                        "kind": "action",
                        "sideEffect": "write",
                        "inputSchema": to_json_schema(&schema.types, &f.params, 0),
                    })
                })
                .collect();
            Ok(json!({"service": service.to_string(), "tools": tools}))
        }
        "build_transaction" => build_transaction(args, chain),
        _ => Err(format!("unknown tool {name}")),
    }
}

fn pack_action(a: &Value, chain: &dyn ChainView) -> Result<(Action, Value), String> {
    let sender = acct(a, "sender")?;
    let service = acct(a, "service")?;
    let method_s = a
        .get("method")
        .and_then(Value::as_str)
        .ok_or("missing method")?;
    let data = a.get("data").cloned().unwrap_or(json!({}));
    let schema = chain
        .schema(service)
        .ok_or(format!("no schema for {service}"))?;
    let f = schema
        .actions
        .get(&MethodString(method_s.to_string()))
        .ok_or(format!("{service} has no action {method_s}"))?;
    if !is_tool_method(method_s) {
        return Err(format!("{service}.{method_s} is not a transaction action"));
    }
    let custom = schema_types();
    let mut cs = CompiledSchema::new(&schema.types, &custom);
    cs.extend(&f.params);
    let raw = cs
        .from_value(&f.params, &data)
        .map_err(|e| format!("{service}.{method_s}: {e}"))?;
    let decoded = cs.to_value(&f.params, &raw).map_err(|e| format!("{e:?}"))?;
    let action = Action {
        sender,
        service,
        method: MethodNumber::from(method_s),
        rawData: Hex(raw),
    };
    let j = json!({
        "sender": sender.to_string(), "service": service.to_string(), "method": method_s,
        "data": decoded, "rawData": action.rawData.to_string()
    });
    Ok((action, j))
}

pub fn build_transaction(args: &Value, chain: &dyn ChainView) -> Result<Value, String> {
    let list = args
        .get("actions")
        .and_then(Value::as_array)
        .ok_or("actions must be an array")?;
    if list.is_empty() {
        return Err("actions is empty".into());
    }
    let mut actions = Vec::new();
    let mut ajson = Vec::new();
    for a in list {
        let (act, j) = pack_action(a, chain)?;
        actions.push(act);
        ajson.push(j);
    }
    let mut notes: Vec<String> = Vec::new();
    // TAPOS: the server fills whatever the caller left out from the node's
    // head block and clock. A full caller-supplied tapos is an override.
    let given = args.get("tapos").and_then(Value::as_object);
    let has = |k: &str| given.map_or(false, |g| g.contains_key(k));
    let need_ref = !(has("refBlockIndex") && has("refBlockSuffix"));
    let need_exp = !has("expiration");
    let mut t = json!({"flags": 0});
    if need_ref || need_exp {
        let head = chain.head_tapos();
        if need_ref {
            t["refBlockIndex"] = json!(head.ref_block_index);
            t["refBlockSuffix"] = json!(head.ref_block_suffix);
        }
        if need_exp {
            let exp = TimePointSec::from(head.now_seconds + TAPOS_EXPIRATION_SECS);
            t["expiration"] = serde_json::to_value(exp).unwrap();
        }
    }
    if let Some(g) = given {
        for (k, v) in g {
            t[k] = v.clone();
        }
    }
    match (need_ref, need_exp) {
        (true, true) => notes.push(format!(
            "tapos filled by the server from the head block; expires in {TAPOS_EXPIRATION_SECS}s: sign and submit before then, or rebuild"
        )),
        (true, false) => notes.push("tapos head reference filled by the server; expiration as supplied".to_string()),
        (false, true) => notes.push(format!(
            "tapos.expiration filled by the server: {TAPOS_EXPIRATION_SECS}s from now"
        )),
        (false, false) => {}
    }
    let tapos: Tapos = serde_json::from_value(t).map_err(|e| format!("bad tapos: {e}"))?;
    let (tx_actions, propose_json) = if let Some(p) = args.get("propose") {
        let proposer = acct(p, "proposer")?;
        let auto_exec = p.get("autoExec").and_then(Value::as_bool).unwrap_or(true);
        let raw = (actions.clone(), auto_exec).packed();
        let wrap = Action {
            sender: proposer,
            service: AccountNumber::from_exact("staged-tx").unwrap(),
            method: MethodNumber::from("propose"),
            rawData: Hex(raw),
        };
        let wj = json!({"sender": proposer.to_string(), "service": "staged-tx", "method": "propose",
            "data": {"actions": ajson, "auto_exec": auto_exec}, "rawData": wrap.rawData.to_string()});
        notes.push(String::from("after it is accepted on chain, call mcp::track(id) if the owner must approve"));
        (vec![wrap], Some(vec![wj]))
    } else {
        (actions, None)
    };
    let tx = Transaction {
        tapos: tapos.clone(),
        actions: tx_actions,
        claims: vec![],
    };
    Ok(json!({
        "transaction": {
            "tapos": serde_json::to_value(&tapos).unwrap(),
            "actions": propose_json.unwrap_or(ajson),
            "claims": [],
        },
        "packed": Hex(tx.packed()).to_string(),
        "notes": notes,
    }))
}

#[cfg(test)]
mod tests;
