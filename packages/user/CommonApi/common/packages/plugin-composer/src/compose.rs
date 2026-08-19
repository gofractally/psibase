use std::collections::{HashMap, HashSet};

use anyhow::{Context, Result, bail};
use wac_graph::types::{Package, SubtypeChecker, are_semver_compatible};
use wac_graph::{CompositionGraph, EncodeOptions, NodeId, PackageId};

use crate::ids::{is_callstack_plugin, PluginId, WasmPlugin};
use crate::partition::{dag_order, inspect_wasm, partition, partition_host};
use crate::tracer::{can_wrap_with_tracer, make_tracer};

#[derive(Clone, Debug)]
pub struct ComposeResult {
    pub wasm: Vec<u8>,
    pub compose_set: Vec<PluginId>,
    pub contains_transact: bool,
}

pub fn compose(
    entry: &PluginId,
    plugins: &[WasmPlugin],
    wrap_tracers: bool,
) -> Result<ComposeResult> {
    let part = partition(entry, plugins)?;
    encode_set(entry, &part.compose_set, plugins, wrap_tracers)
}

pub fn compose_host(plugins: &[WasmPlugin], wrap_tracers: bool) -> Result<ComposeResult> {
    let part = partition_host(plugins)?;
    if part.compose_set.is_empty() {
        bail!("no host plugins to compose (expected prompt)");
    }
    let entry = part
        .compose_set
        .iter()
        .find(|id| id.plugin == "prompt")
        .or_else(|| part.compose_set.iter().find(|id| id.plugin == "db"))
        .or_else(|| part.compose_set.iter().find(|id| id.plugin == "client"))
        .cloned()
        .unwrap();
    encode_set(&entry, &part.compose_set, plugins, wrap_tracers)
}

fn encode_set(
    entry: &PluginId,
    compose_set: &[PluginId],
    plugins: &[WasmPlugin],
    wrap_tracers: bool,
) -> Result<ComposeResult> {
    if compose_set.is_empty() {
        bail!("compose set is empty (entry {entry})");
    }
    let by_id: HashMap<_, _> = plugins.iter().map(|p| (p.id.clone(), p)).collect();
    for id in compose_set {
        if !by_id.contains_key(id) {
            bail!("compose set member {id} has no wasm");
        }
    }

    let contains_transact = compose_set.iter().any(|id| id.is_transact());
    let wasm = if compose_set.len() == 1 && !wrap_tracers {
        by_id[entry].wasm.clone()
    } else {
        compose_graph(compose_set, plugins, wrap_tracers)?
    };

    Ok(ComposeResult {
        wasm,
        compose_set: compose_set.to_vec(),
        contains_transact,
    })
}

fn compose_graph(
    compose_set: &[PluginId],
    plugins: &[WasmPlugin],
    wrap_tracers: bool,
) -> Result<Vec<u8>> {
    let by_id: HashMap<_, _> = plugins.iter().map(|p| (p.id.clone(), p)).collect();
    let (order, back_edges) = dag_order(compose_set, plugins)?;
    let mut graph = CompositionGraph::new();
    let mut providers: HashMap<PluginId, NodeId> = HashMap::new();
    let mut plugin_nodes: HashMap<PluginId, (PackageId, NodeId)> = HashMap::new();

    for id in &order {
        let wasm = &by_id[id].wasm;
        let pkg = Package::from_bytes(&id.key(), None, wasm.clone(), graph.types_mut())
            .with_context(|| format!("register {}", id))?;
        let pkg_id = graph.register_package(pkg)?;
        let inst = graph.instantiate(pkg_id);
        plugin_nodes.insert(id.clone(), (pkg_id, inst));

        let provider = if wrap_tracers
            && !is_callstack_plugin(id)
            && can_wrap_with_tracer(wasm)
        {
            let tracer_bytes = make_tracer(wasm, &id.service)
                .with_context(|| format!("generate tracer for {id}"))?;
            let tpkg = Package::from_bytes(
                &format!("tracer:{}", id.key()),
                None,
                tracer_bytes,
                graph.types_mut(),
            )
            .with_context(|| format!("register tracer for {id}"))?;
            let tpkg_id = graph.register_package(tpkg)?;
            let tinst = graph.instantiate(tpkg_id);
            wire_matching(&mut graph, inst, tinst)?;
            tinst
        } else {
            inst
        };
        providers.insert(id.clone(), provider);
        wire_from_providers(&mut graph, inst, &providers, id, &back_edges)?;
        if provider != inst {
            wire_from_providers(&mut graph, provider, &providers, id, &back_edges)?;
        }
    }

    // Export every composed plugin's providing instance so inbound
    // Supervisor / host / hook-provider calls hit the same instances.
    let mut exported = std::collections::HashSet::new();
    for id in &order {
        let node = providers[id];
        let pkg_id = plugin_nodes[id].0;
        let export_names: Vec<String> = graph.types()[graph[pkg_id].ty()]
            .exports
            .keys()
            .cloned()
            .collect();
        for name in export_names {
            if !exported.insert(name.clone()) {
                continue;
            }
            let alias = graph.alias_instance_export(node, &name)?;
            graph.export(alias, &name)?;
        }
    }

    graph
        .encode(EncodeOptions::default())
        .context("encode composition graph")
}

fn wire_from_providers(
    graph: &mut CompositionGraph,
    consumer: NodeId,
    providers: &HashMap<PluginId, NodeId>,
    consumer_id: &PluginId,
    back_edges: &HashSet<(PluginId, PluginId)>,
) -> Result<()> {
    let Some(pkg_id) = graph[consumer].package() else {
        return Ok(());
    };
    let imports: Vec<String> = graph.types()[graph[pkg_id].ty()]
        .imports
        .keys()
        .cloned()
        .collect();
    let already: std::collections::HashSet<String> = graph
        .get_instantiation_arguments(consumer)
        .map(|(n, _)| n.to_string())
        .collect();

    for import_name in imports {
        if already.contains(&import_name) {
            continue;
        }
        for (provider_id, provider_node) in providers {
            if provider_id == consumer_id {
                continue;
            }
            if back_edges.contains(&(consumer_id.clone(), provider_id.clone())) {
                continue;
            }
            if try_wire(graph, *provider_node, consumer, &import_name)? {
                break;
            }
        }
    }
    Ok(())
}

fn wire_matching(graph: &mut CompositionGraph, plug: NodeId, socket: NodeId) -> Result<()> {
    let Some(socket_pkg) = graph[socket].package() else {
        return Ok(());
    };
    let imports: Vec<String> = graph.types()[graph[socket_pkg].ty()]
        .imports
        .keys()
        .cloned()
        .collect();
    for import_name in imports {
        let _ = try_wire(graph, plug, socket, &import_name)?;
    }
    Ok(())
}

fn try_wire(
    graph: &mut CompositionGraph,
    provider: NodeId,
    consumer: NodeId,
    import_name: &str,
) -> Result<bool> {
    let Some(provider_pkg) = graph[provider].package() else {
        return Ok(false);
    };
    let exports = &graph.types()[graph[provider_pkg].ty()].exports;
    let matching = exports
        .get_key_value(import_name)
        .map(|(n, ty)| (n.clone(), *ty))
        .or_else(|| {
            exports
                .iter()
                .find(|(export_name, _)| are_semver_compatible(export_name, import_name))
                .map(|(n, ty)| (n.clone(), *ty))
        });
    let Some((export_name, plug_ty)) = matching else {
        return Ok(false);
    };

    let Some(consumer_pkg) = graph[consumer].package() else {
        return Ok(false);
    };
    let Some(socket_ty) = graph.types()[graph[consumer_pkg].ty()].imports.get(import_name) else {
        return Ok(false);
    };
    let socket_ty = *socket_ty;

    let mut cache = Default::default();
    let mut checker = SubtypeChecker::new(&mut cache);
    if checker
        .is_subtype(plug_ty, graph.types(), socket_ty, graph.types())
        .is_err()
    {
        return Ok(false);
    }

    let alias = graph.alias_instance_export(provider, &export_name)?;
    match graph.set_instantiation_argument(consumer, import_name, alias) {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}

pub fn remaining_imports(wasm: &[u8]) -> Result<Vec<String>> {
    Ok(inspect_wasm("composed", wasm)?.imports)
}

pub fn remaining_exports(wasm: &[u8]) -> Result<Vec<String>> {
    Ok(inspect_wasm("composed", wasm)?.exports)
}

