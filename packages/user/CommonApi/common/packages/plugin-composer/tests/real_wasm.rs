use plugin_composer::{
    compose, compose_host, partition, remaining_imports, PluginId, WasmPlugin,
};
use std::path::PathBuf;
use std::process::Command;

fn components_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../../../build/components")
}

fn load(service: &str, plugin: &str, file: &str) -> WasmPlugin {
    let path = components_dir().join(file);
    let wasm = std::fs::read(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    WasmPlugin {
        id: PluginId::new(service, plugin),
        wasm,
    }
}

fn psi_packages_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../../../build/share/psibase/packages")
}

fn load_from_psi(psi: &str, inner: &str, service: &str, plugin: &str) -> WasmPlugin {
    let path = psi_packages_dir().join(psi);
    let output = Command::new("unzip")
        .args(["-p", path.to_str().unwrap(), inner])
        .output()
        .unwrap_or_else(|e| panic!("unzip {psi}: {e}"));
    assert!(
        output.status.success() && !output.stdout.is_empty(),
        "unzip -p {psi} {inner} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    WasmPlugin {
        id: PluginId::new(service, plugin),
        wasm: output.stdout,
    }
}

#[test]
fn tracer_can_still_encode_host_db() {
    if !components_dir().join("host_db.wasm").exists() {
        return;
    }
    let wasm = std::fs::read(components_dir().join("host_db.wasm")).unwrap();
    // Encoding works; constructor result is resource-new'd so the inner
    // own<bucket> is the export-table rep.
    match plugin_composer::make_tracer(&wasm, "host") {
        Ok(t) => {
            let imports = remaining_imports(&t).unwrap();
            assert!(
                imports.iter().any(|i| i.starts_with("supervisor:callstack")),
                "db tracer should import callstack, got {imports:?}"
            );
        }
        Err(e) => panic!("host:db tracer encode failed: {e:#}"),
    }
}

#[test]
fn compose_real_host_with_tracers() {
    if !components_dir().join("host_common.wasm").exists() {
        eprintln!("skip: no build/components");
        return;
    }
    let plugins = vec![
        load("host", "common", "host_common.wasm"),
        load("host", "db", "host_db.wasm"),
        load("host", "prompt", "host_prompt.wasm"),
        load("host", "types", "host_types.wasm"),
        load("host", "auth", "host_auth.wasm"),
        load("host", "crypto", "host_crypto.wasm"),
    ];
    match compose_host(&plugins, true) {
        Ok(r) => {
            // TEMP: dump the composite for the JS-side repro of the
            // prompt.html second-get-active-prompt zeroed-bucket bug.
            if let Ok(path) = std::env::var("DUMP_HOST_COMPOSITE") {
                std::fs::write(&path, &r.wasm).unwrap();
                eprintln!("dumped host composite to {path}");
            }
            let imports = remaining_imports(&r.wasm).unwrap();
            println!(
                "host compose ok, compose_set={:?}, wasm={} bytes, imports={:?}",
                r.compose_set.iter().map(|id| id.key()).collect::<Vec<_>>(),
                r.wasm.len(),
                imports
                    .iter()
                    .filter(|i| i.starts_with("host:") || i.starts_with("supervisor:"))
                    .collect::<Vec<_>>()
            );
            assert!(
                r.compose_set.iter().any(|id| id.plugin == "common"),
                "common should be in the host blob, got {:?}",
                r.compose_set.iter().map(|id| id.key()).collect::<Vec<_>>()
            );
            assert!(
                r.compose_set.iter().any(|id| id.plugin == "db"),
                "db should be in the host blob, got {:?}",
                r.compose_set.iter().map(|id| id.key()).collect::<Vec<_>>()
            );
            assert!(
                !imports.iter().any(|i| i.starts_with("host:common/")),
                "prompt→common should be plugged, got {imports:?}"
            );
            assert!(
                !imports.iter().any(|i| i.starts_with("host:db/")),
                "prompt→db should be plugged, got {imports:?}"
            );
        }
        Err(e) => panic!("host compose failed: {e:#}"),
    }
}

#[test]
fn compose_real_host_without_tracers() {
    if !components_dir().join("host_common.wasm").exists() {
        return;
    }
    let plugins = vec![
        load("host", "common", "host_common.wasm"),
        load("host", "db", "host_db.wasm"),
        load("host", "prompt", "host_prompt.wasm"),
    ];
    match compose_host(&plugins, false) {
        Ok(r) => println!("host compose no-tracer ok, {} bytes", r.wasm.len()),
        Err(e) => panic!("host compose no-tracer failed: {e:#}"),
    }
}

#[test]
fn compose_host_plugs_db_when_present() {
    if !components_dir().join("host_db.wasm").exists() {
        return;
    }
    let plugins = vec![
        load("host", "db", "host_db.wasm"),
        load("host", "prompt", "host_prompt.wasm"),
    ];
    match compose_host(&plugins, true) {
        Ok(r) => {
            assert!(
                r.compose_set.iter().any(|id| id.plugin == "db"),
                "db should be in the host blob, got {:?}",
                r.compose_set.iter().map(|id| id.key()).collect::<Vec<_>>()
            );
            let imports = remaining_imports(&r.wasm).unwrap();
            assert!(
                !imports.iter().any(|i| i.starts_with("host:db/")),
                "prompt→db should be plugged, got {imports:?}"
            );
        }
        Err(e) => panic!("{e:#}"),
    }
}

#[test]
fn compose_permissions_query_real_tracers() {
    if !components_dir().join("permissions.wasm").exists() {
        return;
    }
    let plugins = vec![
        load("accounts", "query", "accounts_query.wasm"),
        load("permissions", "plugin", "permissions.wasm"),
    ];
    match compose(&PluginId::new("permissions", "plugin"), &plugins, true) {
        Ok(r) => println!("permissions<-query tracers ok, {} bytes", r.wasm.len()),
        Err(e) => panic!("permissions<-query tracers failed: {e:#}"),
    }
}

#[test]
fn compose_branding_closure_with_perms_chain_id() {
    if !components_dir().join("transact.wasm").exists() {
        return;
    }
    let plugins = vec![
        load("transact", "plugin", "transact.wasm"),
        load("sites", "plugin", "sites.wasm"),
        load("clientdata", "plugin", "clientdata.wasm"),
        load("accounts", "query", "accounts_query.wasm"),
        load("perms", "plugin", "permissions.wasm"),
        load("accounts", "plugin", "accounts.wasm"),
        load("host", "common", "host_common.wasm"),
        load("host", "db", "host_db.wasm"),
        load("host", "prompt", "host_prompt.wasm"),
        load("host", "types", "host_types.wasm"),
        load("host", "auth", "host_auth.wasm"),
        load("host", "crypto", "host_crypto.wasm"),
    ];
    match compose(&PluginId::new("sites", "plugin"), &plugins, false) {
        Ok(r) => println!(
            "sites closure ok set={:?}",
            r.compose_set.iter().map(|id| id.key()).collect::<Vec<_>>()
        ),
        Err(e) => panic!("sites closure failed: {e:#}"),
    }
    match compose(&PluginId::new("transact", "plugin"), &plugins, false) {
        Ok(r) => println!(
            "transact closure ok set={:?}",
            r.compose_set.iter().map(|id| id.key()).collect::<Vec<_>>()
        ),
        Err(e) => panic!("transact closure failed: {e:#}"),
    }
}

/// Homepage-like plugin list from installed .psi packages, including
/// vserver (WIT `virtual-server:plugin`) and tokens. transact ↔ vserver
/// and tokens → transact are WIT cycles; those back-edges stay open.
#[test]
fn compose_branding_from_psi_packages() {
    let branding_psi = psi_packages_dir().join("Branding.psi");
    if !branding_psi.exists() {
        eprintln!("skip: no {}", branding_psi.display());
        return;
    }
    let plugins = vec![
        load_from_psi("Branding.psi", "data/branding/plugin.wasm", "branding", "plugin"),
        load_from_psi("Transact.psi", "data/transact/plugin.wasm", "transact", "plugin"),
        load_from_psi("Sites.psi", "data/sites/plugin.wasm", "sites", "plugin"),
        load_from_psi("ClientData.psi", "data/clientdata/plugin.wasm", "clientdata", "plugin"),
        load_from_psi("Accounts.psi", "data/accounts/query.wasm", "accounts", "query"),
        load_from_psi("Permissions.psi", "data/perms/plugin.wasm", "perms", "plugin"),
        load_from_psi("Accounts.psi", "data/accounts/plugin.wasm", "accounts", "plugin"),
        load_from_psi("VirtualServer.psi", "data/vserver/plugin.wasm", "vserver", "plugin"),
        load_from_psi("Tokens.psi", "data/tokens/plugin.wasm", "tokens", "plugin"),
        load_from_psi("NameMarket.psi", "data/namemarket/plugin.wasm", "namemarket", "plugin"),
        load_from_psi("Host.psi", "data/host/common.wasm", "host", "common"),
        load_from_psi("Host.psi", "data/host/db.wasm", "host", "db"),
        load_from_psi("Host.psi", "data/host/prompt.wasm", "host", "prompt"),
        load_from_psi("Host.psi", "data/host/types.wasm", "host", "types"),
        load_from_psi("Host.psi", "data/host/auth.wasm", "host", "auth"),
        load_from_psi("Host.psi", "data/host/crypto.wasm", "host", "crypto"),
    ];

    let part = partition(&PluginId::new("branding", "plugin"), &plugins).unwrap();
    let set: Vec<_> = part.compose_set.iter().map(|i| i.key()).collect();
    assert!(set.contains(&"vserver:plugin".to_string()), "{set:?}");
    assert!(set.contains(&"tokens:plugin".to_string()), "{set:?}");
    assert!(set.contains(&"perms:plugin".to_string()), "{set:?}");
    assert!(
        set.contains(&"accounts:query".to_string()),
        "accounts:query should be composed: {set:?}"
    );

    let result = compose(&PluginId::new("branding", "plugin"), &plugins, true)
        .unwrap_or_else(|e| panic!("branding compose with tracers failed: {e:#}"));
    println!(
        "branding compose ok set={:?} bytes={}",
        result.compose_set.iter().map(|id| id.key()).collect::<Vec<_>>(),
        result.wasm.len()
    );
    let imports = remaining_imports(&result.wasm).unwrap();
    assert!(
        imports.iter().any(|i| i.starts_with("transact:plugin/")),
        "vserver/tokens back-edges to transact should stay open, got {imports:?}"
    );
    assert!(
        !imports.iter().any(|i| i.starts_with("tokens:plugin/")),
        "forward vserver→tokens should be plugged, got {imports:?}"
    );
    assert!(
        !imports.iter().any(|i| i == "sites:plugin/api"),
        "forward branding→sites api should be plugged, got {imports:?}"
    );
    assert!(
        !imports.iter().any(|i| i.starts_with("accounts:query/")),
        "accounts:query should be plugged, got {imports:?}"
    );
}
