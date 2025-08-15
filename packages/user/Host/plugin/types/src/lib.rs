#[allow(warnings)]
mod bindings;

use bindings::exports::host::types::types::{Guest, GuestPluginRef};

// Simple PluginRef implementation that stores service, plugin, and interface names
pub struct PluginRefImpl {
    service: String,
    plugin: String,
    intf: String,
}

impl GuestPluginRef for PluginRefImpl {
    fn new(service: String, plugin: String, intf: String) -> Self {
        Self { service, plugin, intf }
    }

    fn get_service(&self) -> String {
        self.service.clone()
    }

    fn get_plugin(&self) -> String {
        self.plugin.clone()
    }

    fn get_intf(&self) -> String {
        self.intf.clone()
    }
}

// Export the basic implementation
struct HostTypesImpl;

impl Guest for HostTypesImpl {
    type PluginRef = PluginRefImpl;
}

bindings::export!(HostTypesImpl with_types_in bindings);