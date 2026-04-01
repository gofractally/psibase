#![allow(non_snake_case)]

mod types;

use psibase::{
    services::{
        plugin_info::service::{self as PluginInfoSvc, ParsedFunctions},
        sites::service::{self as Sites, SitesContentRow},
    },
    AccountNumber,
};
use types::*;

fn resolve_plugin_deps(roots: &[(AccountNumber, String)]) -> PluginDepsResponse {
    let mut plugins: std::collections::HashMap<String, PluginInfo> =
        std::collections::HashMap::new();
    let mut queue: std::collections::VecDeque<(AccountNumber, String)> = roots.to_vec().into();
    let mut visited: std::collections::HashSet<(AccountNumber, String)> =
        roots.iter().cloned().collect();

    while let Some((account, plugin_name)) = queue.pop_front() {
        let plugin_key = format!("{account}:{plugin_name}");
        let path = format!("/{plugin_name}.wasm");

        let Some(SitesContentRow { contentHash, .. }) =
            Sites::Wrapper::call().getProps(account, path.clone())
        else {
            continue;
        };

        let Some(cache_row) = PluginInfoSvc::Wrapper::call().getPluginCache(contentHash) else {
            continue;
        };

        let mut deps: Vec<String> = Vec::new();

        for iface in cache_row
            .imported_funcs
            .interfaces
            .iter()
            .filter(|i| i.namespace != "wasi" && i.namespace != "supervisor")
        {
            deps.push(format!("{}:{}", iface.namespace, iface.package));

            let dep_service = AccountNumber::try_from(iface.namespace.as_str()).unwrap();
            let key = (dep_service, iface.package.clone());
            if visited.insert(key.clone()) {
                queue.push_back(key);
            }
        }

        plugins.insert(
            plugin_key,
            PluginInfo {
                importedFuncs: cache_row.imported_funcs.clone(),
                exportedFuncs: cache_row.exported_funcs.clone(),
                deps,
            },
        );
    }

    PluginDepsResponse {
        plugins: plugins
            .into_iter()
            .map(|(plugin_key, info)| PluginDep { plugin_key, info })
            .collect(),
    }
}

#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use super::resolve_plugin_deps;
    use super::types::{PluginDepsResponse, PluginSpec};
    use async_graphql::{Error, Object};
    use psibase::*;

    struct Query;

    #[Object]
    impl Query {
        async fn pluginDeps(&self, plugins: Vec<PluginSpec>) -> Result<PluginDepsResponse, Error> {
            let parsed: Vec<(AccountNumber, String)> = plugins
                .into_iter()
                .filter(|p| !p.plugin.is_empty())
                .map(|p| (p.service, p.plugin))
                .collect();
            if parsed.is_empty() {
                return Err(Error::new("missing or invalid plugin specs"));
            }
            Ok(resolve_plugin_deps(&parsed))
        }
    }

    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        serve_graphql(&request, Query)
    }
}
