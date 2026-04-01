//! Server-side plugin dependency resolution and component metadata parsing.
//!
//! Resolves the full plugin dependency tree and parses imported/exported interfaces
//! for every plugin. CommonApi delegates `/common/graphql` requests here.
//!
//! ## Request flow
//!
//! ```mermaid
//! sequenceDiagram
//!     participant Client as Supervisor (Client)
//!     participant CommonApi as CommonApi (C++)
//!     participant PluginInfo as PluginInfo (Rust)
//!     participant SitesTables as Sites Tables
//!     participant SitesSvc as Sites (getData)
//!
//!     Client->>CommonApi: POST /common/graphql (pluginDeps query)
//!     CommonApi->>PluginInfo: serveSys(request)
//!     loop For each plugin in dependency tree
//!         PluginInfo->>SitesTables: Read SitesContentTable (account, path)
//!         SitesTables-->>PluginInfo: contentHash, contentEncoding
//!         alt Cache miss (should be rare, populated at upload time)
//!             PluginInfo->>SitesSvc: getData(account, path, true)
//!             SitesSvc-->>PluginInfo: raw WASM bytes
//!             PluginInfo->>PluginInfo: Parse component (wasmparser)
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

pub mod parse;

use parse::parse_component;
use psibase::services::sites::service::{self as Sites};
use psibase::AccountNumber;

pub mod tables;

use crate::tables::tables::*;

#[psibase::service(name = "plugin-info", tables = "tables::tables")]
pub mod service {
    use super::*;
    use psibase::*;

    #[action]
    fn cachePlugin(service: AccountNumber, path: String) {
        check(
            get_sender() == Sites::Wrapper::SERVICE,
            "Only Sites service can cache plugins",
        );

        let mapping_table = PluginMappingTable::new();
        let cache_table = PluginCacheTable::new();

        if let Some(content_row) = Sites::Wrapper::call().getProps(service, path.clone()) {
            let content_hash = content_row.contentHash.clone();

            if let Some(existing_mapping) =
                mapping_table.get_index_pk().get(&(service, path.clone()))
            {
                if existing_mapping.content_hash == content_hash
                    && cache_table.get_index_pk().get(&content_hash).is_some()
                {
                    return;
                }
            }

            let bytes = Sites::Wrapper::call().getData(service, path.clone(), true);

            let (imported_funcs, exported_funcs) = parse_component(service, path.as_str(), &bytes);

            let plugin_cache = PluginCacheRow::new(&content_hash, imported_funcs, exported_funcs);
            let mapping = PluginMappingRow::new(service, path.clone(), &content_hash);

            if let Some(old_row) = mapping_table.get_index_pk().get(&(service, path.clone())) {
                if old_row.content_hash != content_hash {
                    cache_table.erase(&old_row.content_hash);
                }
            }

            cache_table.put(&plugin_cache).unwrap();
            mapping_table.put(&mapping).unwrap();
        } else {
            if let Some(mapping_row) = mapping_table.get_index_pk().get(&(service, path.clone())) {
                cache_table.erase(&mapping_row.content_hash);
                mapping_table.erase(&(service, path.clone()));
            }
        }
    }

    #[action]
    fn getPluginCache(content_hash: Checksum256) -> Option<PluginCacheRow> {
        PluginCacheTable::read().get_index_pk().get(&content_hash)
    }
}

#[cfg(test)]
mod tests;
