use psibase_package_naming::{
    check_package, scan_package, validate, EntityType, Occurrence, PackageScan, Severity,
};
use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn cmake_roots() -> Vec<PathBuf> {
    vec![repo_root()]
}

fn cmake_paths(roots: &[PathBuf]) -> Vec<&Path> {
    roots.iter().map(|p| p.as_path()).collect()
}

fn assert_package_ok(relative: &str) {
    let root = repo_root().join(relative);
    let roots = cmake_roots();
    let refs = cmake_paths(&roots);
    let diagnostics = check_package(&root, &refs).unwrap_or_else(|e| {
        panic!("scan failed for {}: {e}", root.display());
    });
    let errors: Vec<_> = diagnostics
        .iter()
        .filter(|d| d.severity == Severity::Error)
        .collect();
    assert!(errors.is_empty(), "{}: {errors:#?}", root.display());
}

fn scan_package_at(relative: &str) -> PackageScan {
    let root = repo_root().join(relative);
    let roots = cmake_roots();
    let refs = cmake_paths(&roots);
    scan_package(&root, &refs).unwrap_or_else(|e| {
        panic!("scan failed for {}: {e}", root.display());
    })
}

#[test]
fn token_swap_passes() {
    assert_package_ok("packages/user/TokenSwap");
}

#[test]
fn prem_accounts_passes_with_intentional_divergence() {
    assert_package_ok("packages/user/PremAccounts");
}

#[test]
fn credentials_passes_cross_service_postinstall() {
    assert_package_ok("packages/system/Credentials");
}

#[test]
fn branding_passes_self_server_pattern() {
    assert_package_ok("packages/user/Branding");
}

#[test]
fn chainmail_passes_self_server_pattern() {
    assert_package_ok("packages/user/Chainmail");
}

#[test]
fn identity_passes_self_server_pattern() {
    assert_package_ok("packages/user/Identity");
}

#[test]
fn virtual_server_passes_self_server_pattern() {
    assert_package_ok("packages/system/VirtualServer");
}

#[test]
fn branding_server_field_correlates_with_service_crate_not_query() {
    let scan = scan_package_at("packages/user/Branding");
    assert!(
        scan.occurrences.iter().any(|o| {
            o.entity == EntityType::ServiceCrate
                && o.group_id == "service_crate:branding"
                && o.value == "branding"
                && o.location
                    .file
                    .to_string_lossy()
                    .contains("service/Cargo.toml")
        }),
        "expected server field in service_crate group"
    );
    assert!(
        !scan
            .occurrences
            .iter()
            .any(|o| o.entity == EntityType::OnChainQuery),
        "self-server packages must not scan on-chain query accounts"
    );
    assert!(
        !scan
            .occurrences
            .iter()
            .any(|o| o.entity == EntityType::QueryCrate),
        "self-server packages must not treat server field as query crate"
    );
}

#[test]
fn diff_adjust_passes_without_plugin() {
    assert_package_ok("packages/user/DiffAdjust");
}

#[test]
fn credentials_postinstall_does_not_correlate_accounts_sender() {
    let scan = scan_package_at("packages/system/Credentials");
    let on_chain: Vec<_> = scan
        .occurrences
        .iter()
        .filter(|o| o.entity == EntityType::OnChainService)
        .map(|o| o.value.as_str())
        .collect();

    assert!(on_chain.contains(&"credential"));
    assert!(
        !on_chain.contains(&"accounts"),
        "cross-service postinstall sender must not join on-chain service group: {on_chain:?}"
    );
}

#[test]
fn token_swap_query_account_matches_service_base() {
    let scan = scan_package_at("packages/user/TokenSwap");
    let service = scan
        .occurrences
        .iter()
        .find(|o| o.entity == EntityType::OnChainService)
        .map(|o| o.value.as_str());
    let query = scan
        .occurrences
        .iter()
        .find(|o| o.entity == EntityType::OnChainQuery)
        .map(|o| o.value.as_str());

    assert_eq!(service, Some("token-swap"));
    assert_eq!(query, Some("token-swap+1"));
}

#[test]
fn broken_service_crate_correlation_is_error() {
    let scan = scan_package_at("packages/user/TokenSwap");
    let mut broken = scan.clone();
    broken.occurrences.push(Occurrence {
        entity: EntityType::ServiceCrate,
        group_id: "service_crate:token-swap".into(),
        value: "wrong-name".into(),
        location: broken.occurrences[0].location.clone(),
    });
    let diagnostics = validate(&broken);
    assert!(diagnostics.iter().any(|d| d.code == "correlationMismatch"));
}

#[test]
fn invalid_on_chain_account_is_error() {
    let scan = scan_package_at("packages/user/TokenSwap");
    let mut broken = scan.clone();
    broken.occurrences.push(Occurrence {
        entity: EntityType::OnChainService,
        group_id: "on_chain_service:token-swap".into(),
        value: "not-a-valid-account-name".into(),
        location: broken.occurrences[0].location.clone(),
    });
    let diagnostics = validate(&broken);
    assert!(diagnostics.iter().any(|d| d.code == "invalidAccountName"));
}

#[test]
fn query_subaccount_base_must_match_service_account() {
    let scan = scan_package_at("packages/user/TokenSwap");
    let mut broken = scan.clone();
    if let Some(query) = broken
        .occurrences
        .iter_mut()
        .find(|o| o.entity == EntityType::OnChainQuery)
    {
        query.value = "other-swap+1".into();
    }
    let diagnostics = validate(&broken);
    assert!(diagnostics.iter().any(|d| d.code == "correlationMismatch"));
}

#[test]
fn token_swap_package_crate_does_not_false_match_service_name() {
    let scan = scan_package_at("packages/user/TokenSwap");
    let root_cargo = repo_root().join("packages/user/TokenSwap/Cargo.toml");

    let line2: Vec<_> = scan
        .occurrences
        .iter()
        .filter(|o| o.location.file == root_cargo && o.location.line == 2)
        .collect();

    assert_eq!(
        line2.len(),
        1,
        "line 2 should have one occurrence: {line2:#?}"
    );
    assert_eq!(line2[0].entity, EntityType::PackageCrate);
    assert_eq!(line2[0].value, "token-swap-pkg");

    assert!(
        !scan.occurrences.iter().any(|o| {
            o.entity == EntityType::ServiceCrate
                && o.location.file == root_cargo
                && o.location.line == 2
        }),
        "service crate must not match inside package crate name on line 2"
    );
}

#[test]
fn token_swap_postinstall_annotates_sender_and_service() {
    let scan = scan_package_at("packages/user/TokenSwap");
    let on_chain_in_service_toml: Vec<_> = scan
        .occurrences
        .iter()
        .filter(|o| {
            o.entity == EntityType::OnChainService
                && o.location
                    .file
                    .to_string_lossy()
                    .ends_with("TokenSwap/service/Cargo.toml")
        })
        .collect();

    let line12: Vec<_> = on_chain_in_service_toml
        .iter()
        .filter(|o| o.location.line == 12)
        .collect();

    assert_eq!(
        line12.len(),
        2,
        "postinstall line should annotate both sender and service; all in service toml: {on_chain_in_service_toml:#?}"
    );
}

#[test]
fn token_swap_root_dependencies_include_query_and_plugin_keys() {
    let scan = scan_package_at("packages/user/TokenSwap");

    for (entity, value, line) in [
        (EntityType::ServiceCrate, "token-swap", 29),
        (EntityType::QueryCrate, "r-token-swap", 30),
        (EntityType::PluginCrate, "token-swap-plugin", 31),
    ] {
        assert!(
            scan.occurrences.iter().any(|o| {
                o.entity == entity
                    && o.value == value
                    && o.location.line == line
                    && o.location
                        .file
                        .to_string_lossy()
                        .ends_with("TokenSwap/Cargo.toml")
            }),
            "expected root [dependencies] key {value} ({entity:?}) on line {line}"
        );
    }
}

#[test]
fn published_package_correlates_cmake_output_for_token_swap() {
    let scan = scan_package_at("packages/user/TokenSwap");
    let published: Vec<_> = scan
        .occurrences
        .iter()
        .filter(|o| o.entity == EntityType::PublishedPackage)
        .map(|o| o.value.as_str())
        .collect();

    assert!(published.iter().any(|v| *v == "TokenSwap"));
}
