use std::fmt;

#[derive(Clone, Debug, Eq, PartialEq, Hash, Ord, PartialOrd)]
pub struct PluginId {
    pub service: String,
    pub plugin: String,
}

impl PluginId {
    pub fn new(service: impl Into<String>, plugin: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            plugin: plugin.into(),
        }
    }

    pub fn key(&self) -> String {
        format!("{}:{}", self.service, self.plugin)
    }

    pub fn is_transact(&self) -> bool {
        self.service == "transact" && self.plugin == "plugin"
    }
}

impl fmt::Display for PluginId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.key())
    }
}

#[derive(Clone, Debug)]
pub struct WasmPlugin {
    pub id: PluginId,
    pub wasm: Vec<u8>,
}

#[derive(Clone, Debug, Default)]
pub struct Partition {
    pub compose_set: Vec<PluginId>,
    pub dynamic_set: Vec<PluginId>,
}

pub const HOOK_PROVIDERS: &[&str] = &[
    "auth-sig",
    "auth-any",
    "auth-delegate",
    "credentials",
    "invite",
];

// Supervisor's JCO instantiate patch stacks borrow / instanceFlags so
// get-sender and bucket.set can re-enter this blob.
pub const HOST_COMPOSE_PLUGINS: &[&str] = &["common", "db", "prompt"];

pub fn is_unplugged_namespace(namespace: &str) -> bool {
    matches!(namespace, "host" | "wasi" | "supervisor") || is_hook_provider(namespace)
}

pub fn is_hook_provider(service: &str) -> bool {
    HOOK_PROVIDERS.contains(&service)
}

pub fn is_unplugged(id: &PluginId) -> bool {
    is_unplugged_namespace(&id.service)
}

pub fn is_host_compose_plugin(id: &PluginId) -> bool {
    id.service == "host" && HOST_COMPOSE_PLUGINS.contains(&id.plugin.as_str())
}

/// Parse a component-model extern name (`ns:pkg/iface@version`) into
/// `(namespace, package, interface)`.
pub fn parse_extern_name(name: &str) -> Option<(String, String, String)> {
    let no_ver = name.split('@').next()?;
    let (pkg, iface) = no_ver.rsplit_once('/')?;
    let (ns, pkg_name) = pkg.split_once(':')?;
    Some((ns.to_string(), pkg_name.to_string(), iface.to_string()))
}

pub fn plugin_id_from_extern(name: &str) -> Option<PluginId> {
    let (ns, pkg, _) = parse_extern_name(name)?;
    Some(PluginId::new(ns, pkg))
}
