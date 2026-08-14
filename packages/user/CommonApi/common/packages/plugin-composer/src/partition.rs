use std::collections::{HashMap, HashSet, VecDeque};

use anyhow::{Context, Result};
use wac_graph::types::Package;
use wac_graph::CompositionGraph;

use crate::ids::{
    is_host_compose_plugin, is_unplugged, plugin_id_from_extern, Partition, PluginId,
    WasmPlugin,
};

#[derive(Clone, Debug)]
pub struct PluginMeta {
    pub id: PluginId,
    /// WIT `ns:pkg` identities taken from the component's exports.
    /// Chain account can differ (e.g. `perms` serves `permissions:plugin`).
    pub wit_ids: Vec<PluginId>,
    pub imports: Vec<String>,
    pub exports: Vec<String>,
}

fn wit_ids_from_externs(names: &[String]) -> Vec<PluginId> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for name in names {
        if let Some(id) = plugin_id_from_extern(name) {
            if seen.insert(id.clone()) {
                out.push(id);
            }
        }
    }
    out
}

fn wit_to_chain(metas: &HashMap<PluginId, PluginMeta>) -> HashMap<PluginId, PluginId> {
    let mut map = HashMap::new();
    for meta in metas.values() {
        map.insert(meta.id.clone(), meta.id.clone());
        for wit in &meta.wit_ids {
            map.insert(wit.clone(), meta.id.clone());
        }
    }
    map
}

fn resolve_wit_dep(
    import: &str,
    by_wit: &HashMap<PluginId, PluginId>,
) -> Option<PluginId> {
    let wit = plugin_id_from_extern(import)?;
    by_wit.get(&wit).cloned()
}

pub fn inspect_plugin(plugin: &WasmPlugin) -> Result<PluginMeta> {
    let mut graph = CompositionGraph::new();
    let pkg = Package::from_bytes(
        &plugin.id.key(),
        None,
        plugin.wasm.clone(),
        graph.types_mut(),
    )
    .with_context(|| format!("failed to parse {}", plugin.id))?;
    let world = &graph.types()[pkg.ty()];
    let exports: Vec<String> = world.exports.keys().cloned().collect();
    Ok(PluginMeta {
        id: plugin.id.clone(),
        wit_ids: wit_ids_from_externs(&exports),
        imports: world.imports.keys().cloned().collect(),
        exports,
    })
}

pub fn inspect_wasm(name: &str, wasm: &[u8]) -> Result<PluginMeta> {
    inspect_plugin(&WasmPlugin {
        id: PluginId::new("tmp", name),
        wasm: wasm.to_vec(),
    })
}

/// WIT closure of `entry`, minus host / WASI / supervisor / hook providers.
/// Plugins in the closure whose wasm is missing stay out of `compose_set`
/// (their imports remain open).
pub fn partition(entry: &PluginId, plugins: &[WasmPlugin]) -> Result<Partition> {
    let metas: HashMap<PluginId, PluginMeta> = plugins
        .iter()
        .map(|p| inspect_plugin(p).map(|m| (p.id.clone(), m)))
        .collect::<Result<_>>()?;

    if !metas.contains_key(entry) {
        anyhow::bail!("entry plugin {entry} is not in the provided plugin list");
    }

    let by_wit = wit_to_chain(&metas);

    let mut compose = Vec::new();
    let mut seen = HashSet::new();
    let mut queue = VecDeque::new();
    queue.push_back(entry.clone());

    while let Some(id) = queue.pop_front() {
        if !seen.insert(id.clone()) {
            continue;
        }
        if is_unplugged(&id) {
            continue;
        }
        let Some(meta) = metas.get(&id) else {
            continue;
        };
        compose.push(id.clone());
        for import in &meta.imports {
            let Some(dep) = resolve_wit_dep(import, &by_wit) else {
                continue;
            };
            if is_unplugged(&dep) {
                continue;
            }
            queue.push_back(dep);
        }
    }

    let compose_set: HashSet<_> = compose.iter().cloned().collect();
    let dynamic_set = plugins
        .iter()
        .map(|p| p.id.clone())
        .filter(|id| !compose_set.contains(id))
        .collect();

    Ok(Partition {
        compose_set: compose,
        dynamic_set,
    })
}

/// Host subset: `common`, `db`, `prompt`. `types` / `auth` / `crypto` stay
/// dynamic. Unlike [`partition`], these host plugins are not treated as
/// unplugged — they are the compose set.
pub fn partition_host(plugins: &[WasmPlugin]) -> Result<Partition> {
    let host: Vec<_> = plugins
        .iter()
        .filter(|p| is_host_compose_plugin(&p.id))
        .cloned()
        .collect();
    if host.is_empty() {
        return Ok(Partition::default());
    }
    let entry = host
        .iter()
        .find(|p| p.id.plugin == "prompt")
        .or_else(|| host.iter().find(|p| p.id.plugin == "db"))
        .or_else(|| host.iter().find(|p| p.id.plugin == "common"))
        .map(|p| p.id.clone())
        .unwrap();

    let metas: HashMap<PluginId, PluginMeta> = host
        .iter()
        .map(|p| inspect_plugin(p).map(|m| (p.id.clone(), m)))
        .collect::<Result<_>>()?;
    let allowed: HashSet<_> = host.iter().map(|p| p.id.clone()).collect();
    let by_wit = wit_to_chain(&metas);

    let mut compose = Vec::new();
    let mut seen = HashSet::new();
    let mut queue = VecDeque::new();
    queue.push_back(entry);

    while let Some(id) = queue.pop_front() {
        if !seen.insert(id.clone()) {
            continue;
        }
        if !allowed.contains(&id) {
            continue;
        }
        let Some(meta) = metas.get(&id) else {
            continue;
        };
        compose.push(id.clone());
        for import in &meta.imports {
            if let Some(dep) = resolve_wit_dep(import, &by_wit) {
                if allowed.contains(&dep) {
                    queue.push_back(dep);
                }
            }
        }
    }

    let compose_set: HashSet<_> = compose.iter().cloned().collect();
    let dynamic_set = plugins
        .iter()
        .map(|p| p.id.clone())
        .filter(|id| !compose_set.contains(id))
        .collect();

    Ok(Partition {
        compose_set: compose,
        dynamic_set,
    })
}

fn in_set_deps(
    id: &PluginId,
    metas: &HashMap<PluginId, PluginMeta>,
    by_wit: &HashMap<PluginId, PluginId>,
    set: &HashSet<PluginId>,
) -> HashSet<PluginId> {
    let Some(meta) = metas.get(id) else {
        return HashSet::new();
    };
    let mut deps = HashSet::new();
    for import in &meta.imports {
        let Some(dep) = resolve_wit_dep(import, by_wit) else {
            continue;
        };
        if dep != *id && set.contains(&dep) {
            deps.insert(dep);
        }
    }
    deps
}

fn visit_back_edges(
    id: &PluginId,
    deps: &HashMap<PluginId, HashSet<PluginId>>,
    color: &mut HashMap<PluginId, u8>,
    back: &mut HashSet<(PluginId, PluginId)>,
) {
    color.insert(id.clone(), 1);
    if let Some(ds) = deps.get(id) {
        for dep in ds {
            match color.get(dep).copied().unwrap_or(0) {
                1 => {
                    back.insert((id.clone(), dep.clone()));
                }
                0 => visit_back_edges(dep, deps, color, back),
                _ => {}
            }
        }
    }
    color.insert(id.clone(), 2);
}

/// WIT imports inside `compose_set` that close a cycle. Those edges stay
/// dynamically linked (`syncCall`); `wac` only wires the remaining DAG.
pub fn dag_order(
    compose_set: &[PluginId],
    plugins: &[WasmPlugin],
) -> Result<(Vec<PluginId>, HashSet<(PluginId, PluginId)>)> {
    let set: HashSet<_> = compose_set.iter().cloned().collect();
    let metas: HashMap<PluginId, PluginMeta> = plugins
        .iter()
        .filter(|p| set.contains(&p.id))
        .map(|p| inspect_plugin(p).map(|m| (p.id.clone(), m)))
        .collect::<Result<_>>()?;
    let by_wit = wit_to_chain(&metas);

    let deps: HashMap<PluginId, HashSet<PluginId>> = compose_set
        .iter()
        .map(|id| (id.clone(), in_set_deps(id, &metas, &by_wit, &set)))
        .collect();

    let mut color: HashMap<PluginId, u8> = compose_set.iter().cloned().map(|id| (id, 0)).collect();
    let mut back = HashSet::new();
    for id in compose_set {
        if color.get(id).copied().unwrap_or(0) == 0 {
            visit_back_edges(id, &deps, &mut color, &mut back);
        }
    }
    let mut incoming: HashMap<PluginId, usize> =
        compose_set.iter().cloned().map(|id| (id, 0)).collect();
    let mut outgoing: HashMap<PluginId, Vec<PluginId>> =
        compose_set.iter().cloned().map(|id| (id, Vec::new())).collect();

    for id in compose_set {
        for dep in &deps[id] {
            if back.contains(&(id.clone(), dep.clone())) {
                continue;
            }
            outgoing.get_mut(dep).unwrap().push(id.clone());
            *incoming.get_mut(id).unwrap() += 1;
        }
    }

    let mut ready: Vec<_> = incoming
        .iter()
        .filter(|(_, n)| **n == 0)
        .map(|(id, _)| id.clone())
        .collect();
    ready.sort();
    let mut order = Vec::new();
    while let Some(id) = ready.pop() {
        order.push(id.clone());
        let children = outgoing.remove(&id).unwrap_or_default();
        for child in children {
            let n = incoming.get_mut(&child).unwrap();
            *n -= 1;
            if *n == 0 {
                ready.push(child);
                ready.sort();
            }
        }
    }

    if order.len() != compose_set.len() {
        let leftover: Vec<_> = compose_set
            .iter()
            .filter(|id| !order.contains(id))
            .map(|id| {
                let mut d: Vec<_> = deps.get(id).into_iter().flatten().map(|d| d.key()).collect();
                d.sort();
                d.dedup();
                format!("{} -> {:?}", id.key(), d)
            })
            .collect();
        anyhow::bail!("compose set is not a DAG; leftover: {}", leftover.join("; "));
    }
    Ok((order, back))
}

pub fn topo_sort(compose_set: &[PluginId], plugins: &[WasmPlugin]) -> Result<Vec<PluginId>> {
    Ok(dag_order(compose_set, plugins)?.0)
}
