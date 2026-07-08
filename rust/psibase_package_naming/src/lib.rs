use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub mod constraints;
mod scan;
mod validate;

pub use scan::scan_package;
pub use validate::validate;

pub const SCHEMA_JSON: &str = include_str!("../schema.json");

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityType {
    PublishedPackage,
    PackageCrate,
    ServiceCrate,
    QueryCrate,
    PluginCrate,
    WitPackage,
    OnChainService,
    OnChainQuery,
}

impl EntityType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PublishedPackage => "published_package",
            Self::PackageCrate => "package_crate",
            Self::ServiceCrate => "service_crate",
            Self::QueryCrate => "query_crate",
            Self::PluginCrate => "plugin_crate",
            Self::WitPackage => "wit_package",
            Self::OnChainService => "on_chain_service",
            Self::OnChainQuery => "on_chain_query",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::PublishedPackage => "Published package (.psi)",
            Self::PackageCrate => "Package crate",
            Self::ServiceCrate => "Service crate",
            Self::QueryCrate => "Query crate",
            Self::PluginCrate => "Plugin crate",
            Self::WitPackage => "WIT component package",
            Self::OnChainService => "On-chain service account",
            Self::OnChainQuery => "On-chain query account",
        }
    }

    pub fn role(self) -> &'static str {
        match self {
            Self::PublishedPackage => "Name of the built `.psi` artifact and installed package.",
            Self::PackageCrate => "Root wrapper crate for this psibase package.",
            Self::ServiceCrate => "Cargo crate for the service implementation.",
            Self::QueryCrate => "Cargo crate for the GraphQL query service.",
            Self::PluginCrate => "Cargo crate for the WASM plugin.",
            Self::WitPackage => "WIT component package identifier for the plugin.",
            Self::OnChainService => "On-chain account name for the service.",
            Self::OnChainQuery => "On-chain account name for the query service.",
        }
    }

    pub fn namespace(self) -> &'static str {
        match self {
            Self::PublishedPackage => "artifact",
            Self::PackageCrate | Self::ServiceCrate | Self::QueryCrate | Self::PluginCrate => {
                "cargo"
            }
            Self::WitPackage => "wit",
            Self::OnChainService | Self::OnChainQuery => "chain",
        }
    }

    pub fn convention(self) -> &'static str {
        match self {
            Self::PublishedPackage => {
                "PascalCase; output filename is case-sensitive"
            }
            Self::PackageCrate => "kebab-case with `-pkg` suffix (e.g. `name-market-pkg`)",
            Self::ServiceCrate => "kebab-case (e.g. `name-market`)",
            Self::QueryCrate => {
                "kebab-case with `r-` prefix (e.g. `r-name-market`); often abbreviated with on-chain account"
            }
            Self::PluginCrate => "kebab-case with `-plugin` suffix (e.g. `name-market-plugin`)",
            Self::WitPackage => {
                "kebab-case service crate + `:plugin` (e.g. `name-market:plugin`); independent of on-chain account"
            }
            Self::OnChainService => {
                "≤10 chars; `a-z`, `0-9`, `-`; no leading/trailing/double hyphen; often abbreviated vs service crate"
            }
            Self::OnChainQuery => "`{on-chain-service}+N` subaccount format; `+1` is usual",
        }
    }

    pub fn constraints(self) -> &'static [&'static str] {
        match self {
            Self::PublishedPackage => &["pascalCase"],
            Self::PackageCrate => &["cargoCrateName"],
            Self::ServiceCrate | Self::QueryCrate | Self::PluginCrate => &["kebabCase"],
            Self::WitPackage => &["witPackage"],
            Self::OnChainService => &["accountNumber"],
            Self::OnChainQuery => &["accountNumberSubaccount"],
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Location {
    pub file: PathBuf,
    pub line: u32,
    pub start_col: u32,
    pub end_col: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Occurrence {
    pub entity: EntityType,
    pub group_id: String,
    pub value: String,
    pub location: Location,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PackageScan {
    pub package_root: PathBuf,
    pub occurrences: Vec<Occurrence>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Diagnostic {
    pub severity: Severity,
    pub code: String,
    pub message: String,
    pub location: Location,
    pub entity: Option<EntityType>,
    pub group_id: Option<String>,
}

pub fn check_package(
    package_root: &std::path::Path,
    cmake_search_roots: &[&std::path::Path],
) -> anyhow::Result<Vec<Diagnostic>> {
    let scan = scan_package(package_root, cmake_search_roots)?;
    Ok(validate(&scan))
}
