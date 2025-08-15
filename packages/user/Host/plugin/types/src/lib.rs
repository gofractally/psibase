#[allow(warnings)]
mod bindings;

use bindings::exports::host::types::types::{Guest, GuestPluginRef};

// Simple PluginRef implementation that stores service, plugin, and interface names
pub struct PluginRefImpl {
    service: String,
    plugin: String,
    intf: String,
}

fn to_camel(s: &str) -> String {
    s.split('-')
        .enumerate()
        .map(|(i, part)| {
            if i == 0 {
                part.to_string()
            } else {
                part[..1].to_uppercase() + &part[1..]
            }
        })
        .collect()
}

impl GuestPluginRef for PluginRefImpl {
    fn new(service: String, plugin: String, intf: String) -> Self {
        Self {
            service,
            plugin,
            intf: to_camel(&intf),
        }
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
