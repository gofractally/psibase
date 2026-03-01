//! Server-side plugin dependency resolution and component metadata parsing.
//!
//! Resolves the full plugin dependency tree and parses imported/exported interfaces
//! for every plugin. CommonApi delegates `/common/plugin-deps` requests here.
//!
//! ## Request flow
//!
//! ```mermaid
//! sequenceDiagram
//!     participant Client as Supervisor (Client)
//!     participant CommonApi as CommonApi (C++)
//!     participant PluginInfo as PluginInfo (Rust)
//!     participant SitesTables as Sites Tables
//!     participant BrotliCodec as BrotliCodec
//!
//!     Client->>CommonApi: GET /common/plugin-deps?p=accounts:plugin
//!     CommonApi->>PluginInfo: serveSys(request)
//!     loop For each plugin in dependency tree
//!         PluginInfo->>SitesTables: Read SitesContentTable (account, path)
//!         SitesTables-->>PluginInfo: contentHash, contentEncoding
//!         alt Cache miss (should be rare, populated at upload time)
//!             PluginInfo->>SitesTables: Read SitesDataTable (hash)
//!             SitesTables-->>PluginInfo: compressed WASM bytes
//!             PluginInfo->>BrotliCodec: decompress(bytes)
//!             BrotliCodec-->>PluginInfo: raw WASM bytes
//!             PluginInfo->>PluginInfo: Parse component (wit-component)
//!             PluginInfo->>PluginInfo: Cache hash to parsed result
//!         end
//!         PluginInfo->>PluginInfo: Enqueue new deps (filter wasi/supervisor)
//!     end
//!     PluginInfo-->>CommonApi: JSON response
//!     CommonApi-->>Client: Full dep tree + parsed APIs
//!     Client->>Client: Fetch all plugin WASMs in parallel
//!     Client->>Client: Transpile with jco (already has API metadata)
//! ```

#![allow(non_snake_case)]

mod parse;

use parse::extract_functions;
use psibase::services::sites::service::{SitesContentTable, SitesDataTable};
use psibase::services::{brotli_svc, sites};
use psibase::subjective_tx;
use psibase::{AccountNumber, Checksum256, Hex, HttpReply, HttpRequest, Table};
use serde::Serialize;
use wasm_compose::graph::Component;
use wit_component::decode;
use wit_parser::World;

#[psibase::service_tables]
mod tables {
    use psibase::{Fracpack, ToSchema};
    use serde::{Deserialize, Serialize};

    use crate::ParsedFunctions;

    #[table(name = "PluginCacheTable", index = 0, db = "Subjective")]
    #[derive(Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct PluginCacheRow {
        #[primary_key]
        pub content_hash: psibase::Checksum256,
        pub imported_funcs: ParsedFunctions,
        pub exported_funcs: ParsedFunctions,
    }

    #[table(name = "PluginMappingTable", index = 1, db = "Subjective")]
    #[derive(Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct PluginMappingRow {
        #[primary_key]
        pub key: (psibase::AccountNumber, String),
        pub content_hash: psibase::Checksum256,
    }
}

#[psibase::service(name = "plugin-info", tables = "tables")]
pub mod service {
    use super::*;
    use crate::tables::{PluginCacheRow, PluginCacheTable, PluginMappingRow, PluginMappingTable};
    use psibase::{subjective_tx, Table};

    #[action]
    fn cachePlugin(service: AccountNumber, path: String) {
        let content_row = SitesContentTable::with_service(sites::SERVICE)
            .get_index_pk()
            .get(&(service, path.clone()));

        if let Some(content_row) = content_row {
            let content_hash = content_row.contentHash.clone();
            let content_encoding = content_row.contentEncoding.clone();

            let Some(data_row) = SitesDataTable::with_service(sites::SERVICE)
                .get_index_pk()
                .get(&content_hash)
            else {
                return;
            };

            let mut bytes = data_row.data.clone();
            if content_encoding.as_deref() == Some("br") {
                bytes = brotli_svc::Wrapper::call().decompress(bytes);
            }

            let Ok((imported_funcs, exported_funcs)) = parse_component(&bytes) else {
                return;
            };

            subjective_tx! {
                let mapping_table = PluginMappingTable::new();
                let cache_table = PluginCacheTable::new();
                let key = (service, path.clone());

                if let Some(old_row) = mapping_table.get_index_pk().get(&key) {
                    if old_row.content_hash != content_hash {
                        cache_table.erase(&old_row.content_hash);
                    }
                }

                cache_table.put(&PluginCacheRow {
                    content_hash: content_hash.clone(),
                    imported_funcs: imported_funcs.clone(),
                    exported_funcs: exported_funcs.clone(),
                }).unwrap();
                mapping_table.put(&PluginMappingRow {
                    key,
                    content_hash: content_hash.clone(),
                }).unwrap();
            }
        } else {
            subjective_tx! {
                let mapping_table = PluginMappingTable::new();
                let cache_table = PluginCacheTable::new();
                let key = (service, path.clone());

                if let Some(mapping_row) = mapping_table.get_index_pk().get(&key) {
                    cache_table.erase(&mapping_row.content_hash);
                    mapping_table.erase(&key);
                }
            }
        }
    }

    #[action]
    fn isCached(content_hash: Checksum256) -> bool {
        subjective_tx! {
            PluginCacheTable::new().get_index_pk().get(&content_hash).is_some()
        }
    }

    #[action]
    fn getPluginContentHash(service: AccountNumber, path: String) -> Option<Checksum256> {
        SitesContentTable::with_service(sites::SERVICE)
            .get_index_pk()
            .get(&(service, path))
            .map(|r| r.contentHash.clone())
    }

    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        let target = request.target.as_str();
        let Some(prefix) = target.strip_prefix("/common/plugin-deps") else {
            return None;
        };
        let Some(query) = prefix.strip_prefix('?') else {
            return None;
        };

        let plugins: Vec<(String, String)> = url::form_urlencoded::parse(query.as_bytes())
            .filter(|(k, _)| k == "p")
            .filter_map(|(_, v)| {
                let mut parts = v.splitn(2, ':');
                let service = parts.next()?.to_string();
                let plugin = parts.next()?.to_string();
                if !service.is_empty() && !plugin.is_empty() {
                    Some((service, plugin))
                } else {
                    None
                }
            })
            .collect();

        if plugins.is_empty() {
            return Some(HttpReply {
                status: 400,
                contentType: "application/json".to_string(),
                body: Hex(br#"{"error":"missing p query params"}"#.to_vec()),
                headers: vec![],
            });
        }

        let result = resolve_plugin_deps(&plugins);
        let body = serde_json::to_vec(&result).unwrap_or_else(|_| b"{}".to_vec());

        Some(HttpReply {
            status: 200,
            contentType: "application/json".to_string(),
            body: Hex(body),
            headers: vec![],
        })
    }
}

fn get_cached_parsed(content_hash: &Checksum256) -> Option<(ParsedFunctions, ParsedFunctions)> {
    subjective_tx! {
        crate::tables::PluginCacheTable::new()
            .get_index_pk()
            .get(content_hash)
            .map(|r| (r.imported_funcs.clone(), r.exported_funcs.clone()))
    }
}

fn parse_component(bytes: &[u8]) -> Result<(ParsedFunctions, ParsedFunctions), String> {
    let component = Component::from_bytes("component".to_string(), bytes.to_vec())
        .map_err(|e| format!("{e:#}"))?;
    let decoded = decode(component.bytes()).map_err(|e| format!("{e:#}"))?;
    let resolve = decoded.resolve();

    let worlds = &resolve.worlds;
    let (_name, _world) = worlds.iter().next().ok_or("component has no world")?;

    let imported_funcs = extract_functions(resolve, |w: &World| &w.imports);
    let exported_funcs = extract_functions(resolve, |w: &World| &w.exports);

    Ok((imported_funcs, exported_funcs))
}

fn resolve_plugin_deps(roots: &[(String, String)]) -> PluginDepsResponse {
    let mut plugins: std::collections::HashMap<String, PluginInfoEntry> =
        std::collections::HashMap::new();
    let mut queue: std::collections::VecDeque<(String, String)> = roots.to_vec().into();
    let mut visited: std::collections::HashSet<(String, String)> = roots.iter().cloned().collect();

    while let Some((service, plugin_name)) = queue.pop_front() {
        let plugin_key = format!("{service}:{plugin_name}");
        let path = format!("/{plugin_name}.wasm");
        let account = match AccountNumber::try_from(service.as_str()) {
            Ok(a) => a,
            Err(_) => continue,
        };

        let Some(content_row) = SitesContentTable::with_service(sites::SERVICE)
            .get_index_pk()
            .get(&(account, path.clone()))
        else {
            plugins.insert(
                plugin_key.clone(),
                PluginInfoEntry {
                    importedFuncs: ParsedFunctions::default(),
                    exportedFuncs: ParsedFunctions::default(),
                    deps: vec![],
                },
            );
            continue;
        };

        let content_hash = content_row.contentHash.clone();

        let cached = get_cached_parsed(&content_hash);

        let (imported_funcs, exported_funcs) = cached.unwrap_or_else(|| {
            let Some(data_row) = SitesDataTable::with_service(sites::SERVICE)
                .get_index_pk()
                .get(&content_hash)
            else {
                return (ParsedFunctions::default(), ParsedFunctions::default());
            };

            let mut bytes = data_row.data.clone();
            if content_row.contentEncoding.as_deref() == Some("br") {
                bytes = brotli_svc::Wrapper::call().decompress(bytes);
            }

            let Some((imported, exported)) = parse_component(&bytes).ok() else {
                return (ParsedFunctions::default(), ParsedFunctions::default());
            };

            let ch = content_hash.clone();
            subjective_tx! {
                crate::tables::PluginCacheTable::new()
                    .put(&crate::tables::PluginCacheRow {
                        content_hash: ch.clone(),
                        imported_funcs: imported.clone(),
                        exported_funcs: exported.clone(),
                    })
                    .unwrap();
                crate::tables::PluginMappingTable::new()
                    .put(&crate::tables::PluginMappingRow {
                        key: (account, path.clone()),
                        content_hash: ch.clone(),
                    })
                    .unwrap();
            }

            (imported, exported)
        });

        let deps: Vec<String> = imported_funcs
            .interfaces
            .iter()
            .filter(|i| i.namespace != "wasi" && i.namespace != "supervisor")
            .map(|i| format!("{}:{}", i.namespace, i.package))
            .collect();

        for dep in &deps {
            if let Some((svc, pkg)) = dep.split_once(':') {
                let key = (svc.to_string(), pkg.to_string());
                if visited.insert(key.clone()) {
                    queue.push_back(key);
                }
            }
        }

        plugins.insert(
            plugin_key,
            PluginInfoEntry {
                importedFuncs: imported_funcs.clone(),
                exportedFuncs: exported_funcs.clone(),
                deps,
            },
        );
    }

    PluginDepsResponse { plugins }
}

#[derive(Serialize)]
struct PluginDepsResponse {
    plugins: std::collections::HashMap<String, PluginInfoEntry>,
}

#[derive(Serialize)]
struct PluginInfoEntry {
    #[serde(rename = "importedFuncs")]
    importedFuncs: ParsedFunctions,
    #[serde(rename = "exportedFuncs")]
    exportedFuncs: ParsedFunctions,
    deps: Vec<String>,
}

#[derive(
    Clone, Default, serde::Serialize, serde::Deserialize, psibase::Fracpack, psibase::ToSchema,
)]
pub struct ParsedFunction {
    pub name: String,
    #[serde(rename = "dynamicLink")]
    pub dynamic_link: bool,
}

#[derive(
    Clone, Default, serde::Serialize, serde::Deserialize, psibase::Fracpack, psibase::ToSchema,
)]
pub struct ParsedInterface {
    pub namespace: String,
    pub package: String,
    pub name: String,
    pub funcs: Vec<ParsedFunction>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize, psibase::Fracpack, psibase::ToSchema)]
pub struct ParsedFunctions {
    pub namespace: String,
    pub package: String,
    pub interfaces: Vec<ParsedInterface>,
    pub funcs: Vec<ParsedFunction>,
}

impl Default for ParsedFunctions {
    fn default() -> Self {
        Self {
            namespace: "root".to_string(),
            package: "component".to_string(),
            interfaces: vec![],
            funcs: vec![],
        }
    }
}

#[cfg(test)]
mod tests;
