mod compose;
mod ids;
mod partition;
mod tracer;

pub use compose::{compose, compose_host, remaining_exports, remaining_imports, ComposeResult};
pub use ids::{
    is_hook_provider, is_unplugged_namespace, parse_extern_name, Partition, PluginId, WasmPlugin,
    HOOK_PROVIDERS, HOST_COMPOSE_PLUGINS,
};
pub use partition::{
    dag_order, inspect_plugin, inspect_wasm, partition, partition_host, topo_sort,
};

#[cfg(target_arch = "wasm32")]
#[allow(warnings)]
mod bindings;

#[cfg(target_arch = "wasm32")]
struct Component;

#[cfg(target_arch = "wasm32")]
impl bindings::Guest for Component {
    fn compose(
        entry: bindings::PluginId,
        plugins: Vec<bindings::WasmPlugin>,
        wrap_inner_tracers: bool,
    ) -> Result<bindings::ComposeResult, String> {
        let entry = PluginId::new(entry.service, entry.plugin);
        let plugins = plugins
            .into_iter()
            .map(|p| WasmPlugin {
                id: PluginId::new(p.service, p.plugin),
                wasm: p.wasm,
            })
            .collect::<Vec<_>>();
        compose(&entry, &plugins, wrap_inner_tracers)
            .map(into_wit_result)
            .map_err(|e| format!("{e:#}"))
    }

    fn compose_host(
        plugins: Vec<bindings::WasmPlugin>,
        wrap_inner_tracers: bool,
    ) -> Result<bindings::ComposeResult, String> {
        let plugins = plugins
            .into_iter()
            .map(|p| WasmPlugin {
                id: PluginId::new(p.service, p.plugin),
                wasm: p.wasm,
            })
            .collect::<Vec<_>>();
        compose_host(&plugins, wrap_inner_tracers)
            .map(into_wit_result)
            .map_err(|e| format!("{e:#}"))
    }
}

#[cfg(target_arch = "wasm32")]
fn into_wit_result(result: ComposeResult) -> bindings::ComposeResult {
    bindings::ComposeResult {
        wasm: result.wasm,
        compose_set: result
            .compose_set
            .into_iter()
            .map(|id| bindings::PluginId {
                service: id.service,
                plugin: id.plugin,
            })
            .collect(),
        contains_transact: result.contains_transact,
    }
}

#[cfg(target_arch = "wasm32")]
bindings::export!(Component with_types_in bindings);
