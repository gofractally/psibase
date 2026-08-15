use plugin_composer::{
    compose, inspect_wasm, partition, remaining_imports, PluginId, WasmPlugin,
};
use wit_component::{dummy_module, embed_component_metadata, ComponentEncoder, StringEncoding};
use wit_parser::{LiftLowerAbi, ManglingAndAbi, Resolve};

fn dummy_component_with_deps(wit: &str, deps: &[&str]) -> Vec<u8> {
    let mut resolve = Resolve::new();
    for (i, dep) in deps.iter().enumerate() {
        resolve
            .push_str(&format!("dep{i}.wit"), dep)
            .unwrap_or_else(|e| panic!("parse dep {i}: {e:#}\n{dep}"));
    }
    let pkg = resolve
        .push_str("test.wit", wit)
        .unwrap_or_else(|e| panic!("parse wit: {e:#}\n{wit}"));
    let world = resolve
        .select_world(&[pkg], None)
        .unwrap_or_else(|e| panic!("select world: {e:#}"));
    let mut module = dummy_module(
        &resolve,
        world,
        ManglingAndAbi::Legacy(LiftLowerAbi::Sync),
    );
    embed_component_metadata(&mut module, &resolve, world, StringEncoding::UTF8).unwrap();
    ComponentEncoder::default()
        .validate(true)
        .module(&module)
        .unwrap()
        .encode()
        .unwrap()
}

const HOST_CLIENT: &str = r#"
package host:client;
interface api { get-sender: func() -> string; }
"#;

const AUTH_SIG: &str = r#"
package auth-sig:plugin;
interface api { verify: func() -> bool; }
"#;

const ACCOUNTS_QUERY: &str = r#"
package accounts:query;
interface api { get-current-user: func() -> option<string>; }
"#;

const PERMISSIONS_API: &str = r#"
package permissions:plugin;
interface api { is-authorized: func() -> bool; }
"#;

const CLIENTDATA_ADMIN: &str = r#"
package clientdata:plugin;
interface admin { get: func() -> option<string>; }
"#;

const TRANSACT_API: &str = r#"
package transact:plugin;
interface api { add-action: func(); }
interface admin { start-tx: func(); }
"#;

const TRANSACT_ACTIONS: &str = r#"
package transact:actions;
interface intf { add-action-to-transaction: func(); }
"#;

const CREDENTIALS_API: &str = r#"
package credentials:plugin;
interface api { sign-latch: func(); }
"#;

fn plugin(service: &str, plugin: &str, wit: &str) -> WasmPlugin {
    plugin_with_deps(service, plugin, wit, &[HOST_CLIENT])
}

fn plugin_with_deps(service: &str, plugin: &str, wit: &str, deps: &[&str]) -> WasmPlugin {
    WasmPlugin {
        id: PluginId::new(service, plugin),
        wasm: dummy_component_with_deps(wit, deps),
    }
}

fn has_import(imports: &[String], needle: &str) -> bool {
    imports.iter().any(|i| i.starts_with(needle) || i.contains(needle))
}

#[test]
fn partition_permissions_excludes_host() {
    let query = plugin(
        "accounts",
        "query",
        r#"
package accounts:query;
interface api { get-current-user: func() -> option<string>; }
world impl {
    import host:client/api;
    export api;
}
"#,
    );
    let permissions = plugin_with_deps(
        "permissions",
        "plugin",
        r#"
package permissions:plugin;
interface api { is-authorized: func() -> bool; }
world impl {
    import accounts:query/api;
    import host:client/api;
    export api;
}
"#,
        &[HOST_CLIENT, ACCOUNTS_QUERY],
    );
    let part = partition(&permissions.id.clone(), &[query, permissions]).unwrap();
    let keys: Vec<_> = part.compose_set.iter().map(|id| id.key()).collect();
    assert!(keys.contains(&"permissions:plugin".to_string()));
    assert!(
        keys.contains(&"accounts:query".to_string()),
        "accounts:query should be composed: {keys:?}"
    );
    assert!(!keys.iter().any(|k| k.starts_with("host:")));
}

#[test]
fn partition_maps_wit_package_to_chain_account() {
    let perms = plugin_with_deps(
        "perms",
        "plugin",
        r#"
package permissions:plugin;
interface api { is-authorized: func() -> bool; }
world impl {
    import host:client/api;
    export api;
}
"#,
        &[HOST_CLIENT],
    );
    let transact = plugin_with_deps(
        "transact",
        "plugin",
        r#"
package transact:plugin;
interface admin { start-tx: func(); }
world impl {
    import permissions:plugin/api;
    import host:client/api;
    export admin;
}
"#,
        &[HOST_CLIENT, PERMISSIONS_API],
    );
    let part = partition(&transact.id.clone(), &[transact, perms]).unwrap();
    let keys: Vec<_> = part.compose_set.iter().map(|id| id.key()).collect();
    assert!(
        keys.contains(&"perms:plugin".to_string()),
        "chain account perms:plugin should be in compose set, got {keys:?}"
    );
    assert!(keys.contains(&"transact:plugin".to_string()));
    assert!(!keys.contains(&"permissions:plugin".to_string()));
}

#[test]
fn compose_closes_permissions_import_when_chain_account_differs() {
    let perms = plugin_with_deps(
        "perms",
        "plugin",
        r#"
package permissions:plugin;
interface api { is-authorized: func() -> bool; }
world impl {
    import host:client/api;
    export api;
}
"#,
        &[HOST_CLIENT],
    );
    let transact = plugin_with_deps(
        "transact",
        "plugin",
        r#"
package transact:plugin;
interface admin { start-tx: func(); }
world impl {
    import permissions:plugin/api;
    import host:client/api;
    export admin;
}
"#,
        &[HOST_CLIENT, PERMISSIONS_API],
    );
    let result = compose(&transact.id.clone(), &[transact, perms], false).unwrap();
    let imports = remaining_imports(&result.wasm).unwrap();
    assert!(
        !has_import(&imports, "permissions:plugin/api"),
        "permissions:plugin/api should be closed, got {imports:?}"
    );
    assert!(result.compose_set.iter().any(|id| id.service == "perms"));
}

#[test]
fn compose_leaves_cycle_back_edge_open() {
    const A_API: &str = r#"
package a:plugin;
interface api { ping: func(); }
"#;
    const B_API: &str = r#"
package b:plugin;
interface api { pong: func(); }
"#;
    let a = plugin_with_deps(
        "a",
        "plugin",
        r#"
package a:plugin;
interface api { ping: func(); }
world impl {
    import b:plugin/api;
    export api;
}
"#,
        &[B_API],
    );
    let b = plugin_with_deps(
        "b",
        "plugin",
        r#"
package b:plugin;
interface api { pong: func(); }
world impl {
    import a:plugin/api;
    export api;
}
"#,
        &[A_API],
    );
    let result = compose(&a.id.clone(), &[a, b], false).unwrap();
    let keys: Vec<_> = result.compose_set.iter().map(|id| id.key()).collect();
    assert!(keys.contains(&"a:plugin".to_string()), "{keys:?}");
    assert!(keys.contains(&"b:plugin".to_string()), "{keys:?}");
    let imports = remaining_imports(&result.wasm).unwrap();
    assert!(
        !has_import(&imports, "b:plugin/api"),
        "forward edge a→b should be plugged, got {imports:?}"
    );
    assert!(
        has_import(&imports, "a:plugin/api"),
        "back-edge b→a should stay open, got {imports:?}"
    );
}

#[test]
fn partition_skips_hook_providers() {
    let transact = plugin_with_deps(
        "transact",
        "plugin",
        r#"
package transact:plugin;
interface admin { start-tx: func(); }
interface hook-handlers { on-auth: func(); }
world impl {
    import accounts:query/api;
    import hook-handlers;
    import auth-sig:plugin/api;
    export admin;
}
"#,
        &[HOST_CLIENT, AUTH_SIG, ACCOUNTS_QUERY],
    );
    let query = plugin(
        "accounts",
        "query",
        r#"
package accounts:query;
interface api { get-current-user: func() -> option<string>; }
world impl { export api; }
"#,
    );
    let auth = plugin(
        "auth-sig",
        "plugin",
        r#"
package auth-sig:plugin;
interface api { verify: func() -> bool; }
world impl { export api; }
"#,
    );
    let part = partition(&transact.id.clone(), &[transact, query, auth]).unwrap();
    let keys: Vec<_> = part.compose_set.iter().map(|id| id.key()).collect();
    assert!(keys.contains(&"transact:plugin".to_string()));
    assert!(
        keys.contains(&"accounts:query".to_string()),
        "accounts:query should be composed: {keys:?}"
    );
    assert!(!keys.contains(&"auth-sig:plugin".to_string()));
}

#[test]
fn partition_includes_hook_provider_when_it_is_the_entry() {
    let actions = plugin(
        "transact",
        "actions",
        r#"
package transact:actions;
interface intf { add-action-to-transaction: func(); }
world impl { export intf; }
"#,
    );
    let credentials = plugin(
        "credentials",
        "plugin",
        r#"
package credentials:plugin;
interface api { sign-latch: func(); }
world impl { export api; }
"#,
    );
    let invite = plugin_with_deps(
        "invite",
        "plugin",
        r#"
package invite:plugin;
interface inviter { generate-invite: func() -> string; }
world impl {
    import transact:actions/intf;
    import credentials:plugin/api;
    export inviter;
}
"#,
        &[TRANSACT_ACTIONS, CREDENTIALS_API],
    );
    let invite_id = invite.id.clone();
    let plugins = [invite, actions, credentials];
    let part = partition(&invite_id, &plugins).unwrap();
    let keys: Vec<_> = part.compose_set.iter().map(|id| id.key()).collect();
    assert!(
        keys.contains(&"invite:plugin".to_string()),
        "hook-provider entry must be composed: {keys:?}"
    );
    assert!(
        keys.contains(&"transact:actions".to_string()),
        "invite's static DAG should be composed: {keys:?}"
    );
    assert!(
        !keys.contains(&"credentials:plugin".to_string()),
        "other hook providers stay out even when the entry is a hook provider: {keys:?}"
    );

    let result = compose(&invite_id, &plugins, false)
        .expect("hook-provider entry must produce a non-empty compose set");
    assert!(result.compose_set.iter().any(|id| id.service == "invite"));
}

#[test]
fn plug_permissions_closes_query_import() {
    let query = plugin(
        "accounts",
        "query",
        r#"
package accounts:query;
interface api { get-current-user: func() -> option<string>; }
world impl {
    import host:client/api;
    export api;
}
"#,
    );
    let permissions = plugin_with_deps(
        "permissions",
        "plugin",
        r#"
package permissions:plugin;
interface api { is-authorized: func() -> bool; }
world impl {
    import accounts:query/api;
    import host:client/api;
    export api;
}
"#,
        &[HOST_CLIENT, ACCOUNTS_QUERY],
    );
    let result = compose(&permissions.id.clone(), &[query, permissions], false).unwrap();
    let imports = remaining_imports(&result.wasm).unwrap();
    assert!(
        !has_import(&imports, "accounts:query/api"),
        "accounts:query should be plugged, got {imports:?}"
    );
    assert!(
        has_import(&imports, "host:client"),
        "host import should remain, got {imports:?}"
    );
    assert!(result.compose_set.iter().any(|id| id.service == "permissions"));
    assert!(result.compose_set.iter().any(|id| id.plugin == "query"));
}

#[test]
fn nested_transact_keeps_hook_handlers_open() {
    let query = plugin(
        "accounts",
        "query",
        r#"
package accounts:query;
interface api { get-current-user: func() -> option<string>; }
world impl { export api; }
"#,
    );
    let permissions = plugin_with_deps(
        "permissions",
        "plugin",
        r#"
package permissions:plugin;
interface api { is-authorized: func() -> bool; }
world impl {
    import accounts:query/api;
    export api;
}
"#,
        &[ACCOUNTS_QUERY],
    );
    let clientdata = plugin(
        "clientdata",
        "plugin",
        r#"
package clientdata:plugin;
interface admin { get: func() -> option<string>; }
world impl { export admin; }
"#,
    );
    let transact = plugin_with_deps(
        "transact",
        "plugin",
        r#"
package transact:plugin;
interface admin { start-tx: func(); finish-tx: func(); }
interface hook-handlers { on-auth: func(); }
world impl {
    import accounts:query/api;
    import permissions:plugin/api;
    import clientdata:plugin/admin;
    import hook-handlers;
    export admin;
}
"#,
        &[ACCOUNTS_QUERY, PERMISSIONS_API, CLIENTDATA_ADMIN],
    );
    let result = compose(
        &transact.id.clone(),
        &[query, permissions, clientdata, transact],
        false,
    )
    .unwrap();
    let imports = remaining_imports(&result.wasm).unwrap();
    assert!(
        !has_import(&imports, "accounts:query/api"),
        "accounts:query should be plugged: {imports:?}"
    );
    assert!(
        !has_import(&imports, "permissions:plugin/api"),
        "permissions should be closed: {imports:?}"
    );
    assert!(
        !has_import(&imports, "clientdata:plugin/admin"),
        "clientdata should be closed: {imports:?}"
    );
    assert!(
        has_import(&imports, "hook-handlers"),
        "hook-handlers must stay open: {imports:?}"
    );
    assert!(result.contains_transact);
}

#[test]
fn setcode_socket_keeps_own_exports_and_transact_admin() {
    let transact = plugin(
        "transact",
        "plugin",
        r#"
package transact:plugin;
interface admin { start-tx: func(); }
interface api { add-action: func(); }
world impl { export admin; export api; }
"#,
    );
    let setcode = plugin_with_deps(
        "setcode",
        "plugin",
        r#"
package setcode:plugin;
interface api { set-code: func(); }
world impl {
    import transact:plugin/api;
    export api;
}
"#,
        &[TRANSACT_API],
    );
    let result = compose(&setcode.id.clone(), &[transact, setcode], false).unwrap();
    let exports = plugin_composer::remaining_exports(&result.wasm).unwrap();
    assert!(
        exports.iter().any(|e| e.contains("setcode:plugin/api") || (e.ends_with("/api") && e.contains("setcode"))),
        "socket export missing: {exports:?}"
    );
    assert!(
        exports.iter().any(|e| e.contains("transact:plugin/admin") || e.contains("admin")),
        "transact admin should be re-exported for start-tx: {exports:?}"
    );
}

#[test]
fn tracers_wrap_the_entry_plugin() {
    let entry = plugin(
        "branding",
        "plugin",
        r#"
package branding:plugin;
interface queries { get-network-name: func() -> string; }
world impl { export queries; }
"#,
    );
    let result = compose(&entry.id.clone(), &[entry], true).unwrap();
    let imports = remaining_imports(&result.wasm).unwrap();
    assert!(
        has_import(&imports, "supervisor:callstack"),
        "entry plugin must be tracer-wrapped, got {imports:?}"
    );
}

#[test]
fn tracers_add_callstack_import() {
    let query = plugin(
        "accounts",
        "query",
        r#"
package accounts:query;
interface api { get-current-user: func() -> option<string>; }
world impl { export api; }
"#,
    );
    let permissions = plugin_with_deps(
        "permissions",
        "plugin",
        r#"
package permissions:plugin;
interface api { is-authorized: func() -> bool; }
world impl {
    import accounts:query/api;
    export api;
}
"#,
        &[ACCOUNTS_QUERY],
    );
    let result = compose(&permissions.id.clone(), &[query, permissions], true).unwrap();
    let imports = remaining_imports(&result.wasm).unwrap();
    assert!(
        has_import(&imports, "supervisor:callstack"),
        "tracers should import callstack, got {imports:?}"
    );
    assert!(
        !has_import(&imports, "accounts:query/api"),
        "accounts:query should be plugged: {imports:?}"
    );
}

const HOST_TYPES: &str = r#"
package host:types;
interface types {
    record error { code: u32, message: string }
}
"#;

#[test]
fn tracers_wrap_exports_that_use_foreign_types() {
    let inner = plugin_with_deps(
        "permissions",
        "plugin",
        r#"
package permissions:plugin;
interface api {
    use host:types/types.{error};
    is-authorized: func() -> result<bool, error>;
}
world impl {
    import host:types/types;
    export api;
}
"#,
        &[HOST_TYPES],
    );
    let entry = plugin_with_deps(
        "setcode",
        "plugin",
        r#"
package setcode:plugin;
interface api { set: func(); }
world impl {
    import permissions:plugin/api;
    export api;
}
"#,
        &[
            HOST_TYPES,
            r#"
package permissions:plugin;
interface api {
    use host:types/types.{error};
    is-authorized: func() -> result<bool, error>;
}
"#,
        ],
    );
    let result = compose(&entry.id.clone(), &[inner, entry], true).unwrap();
    let imports = remaining_imports(&result.wasm).unwrap();
    assert!(
        has_import(&imports, "supervisor:callstack"),
        "inner tracer should import callstack, got {imports:?}"
    );
}

#[test]
fn tracers_wrap_plugins_that_export_resources() {
    let inner = plugin_with_deps(
        "kv",
        "plugin",
        r#"
package kv:plugin;
interface store {
    resource bucket {
        constructor();
        get: func() -> string;
    }
    flush: func();
}
world impl { export store; }
"#,
        &[],
    );
    let entry = plugin_with_deps(
        "app",
        "plugin",
        r#"
package app:plugin;
interface api { ping: func(); }
world impl {
    import kv:plugin/store;
    export api;
}
"#,
        &[r#"
package kv:plugin;
interface store {
    resource bucket {
        constructor();
        get: func() -> string;
    }
    flush: func();
}
"#],
    );
    let result = compose(&entry.id.clone(), &[inner, entry], true).unwrap();
    let imports = remaining_imports(&result.wasm).unwrap();
    assert!(
        !has_import(&imports, "kv:plugin/store"),
        "resource plugin should still be closed: {imports:?}"
    );
    assert!(
        has_import(&imports, "supervisor:callstack"),
        "resource plugin should be tracer-wrapped: {imports:?}"
    );
}

#[test]
fn host_subset_composes_without_types_crypto() {
    const HOST_DB: &str = r#"
package host:db;
interface store { get: func() -> string; }
"#;
    const HOST_AUTH: &str = r#"
package host:auth;
interface api { get-active-query-token: func() -> option<string>; }
"#;
    let client = plugin_with_deps(
        "host",
        "client",
        r#"
package host:client;
interface api { get-sender: func() -> string; }
world impl { export api; }
"#,
        &[],
    );
    let db = plugin_with_deps(
        "host",
        "db",
        r#"
package host:db;
interface store { get: func() -> string; }
world impl {
    import host:client/api;
    export store;
}
"#,
        &[HOST_CLIENT],
    );
    let auth = plugin_with_deps(
        "host",
        "auth",
        r#"
package host:auth;
interface api { get-active-query-token: func() -> option<string>; }
world impl {
    import host:client/api;
    import host:db/store;
    export api;
}
"#,
        &[HOST_CLIENT, HOST_DB],
    );
    // http and prompt are the tops of the host DAG — nothing in the
    // blob imports them, so composing them proves the multi-root walk.
    let http = plugin_with_deps(
        "host",
        "http",
        r#"
package host:http;
interface api { post: func() -> string; }
world impl {
    import host:client/api;
    import host:auth/api;
    export api;
}
"#,
        &[HOST_CLIENT, HOST_AUTH],
    );
    let prompt = plugin_with_deps(
        "host",
        "prompt",
        r#"
package host:prompt;
interface admin { get-active-prompt: func() -> string; }
world impl {
    import host:client/api;
    import host:db/store;
    export admin;
}
"#,
        &[HOST_CLIENT, HOST_DB],
    );
    let types = plugin(
        "host",
        "types",
        r#"
package host:types;
interface api { ping: func(); }
world impl { export api; }
"#,
    );
    let result = plugin_composer::compose_host(
        &[client, db, auth, http, prompt, types],
        false,
    )
    .unwrap();
    let keys: Vec<_> = result.compose_set.iter().map(|id| id.plugin.clone()).collect();
    for expected in ["client", "db", "auth", "http", "prompt"] {
        assert!(
            keys.contains(&expected.to_string()),
            "{expected} should be in the host blob: {keys:?}"
        );
    }
    assert!(!keys.contains(&"types".to_string()));
    let imports = remaining_imports(&result.wasm).unwrap();
    assert!(
        !has_import(&imports, "host:client/api"),
        "client should be plugged: {imports:?}"
    );
    assert!(
        !has_import(&imports, "host:db/store"),
        "db should be plugged: {imports:?}"
    );
    assert!(
        !has_import(&imports, "host:auth/api"),
        "http → auth should be plugged: {imports:?}"
    );
}

#[test]
fn inspect_roundtrip() {
    let p = plugin(
        "demo",
        "plugin",
        r#"
package demo:plugin;
interface api { ping: func(); }
world impl { export api; }
"#,
    );
    let meta = inspect_wasm("demo", &p.wasm).unwrap();
    assert!(meta.exports.iter().any(|e| e.contains("api")));
}
