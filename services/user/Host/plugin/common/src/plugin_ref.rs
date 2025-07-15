use crate::exports::host::common::types::GuestPluginRef;

pub struct PluginRef {
    pub service: String,
    pub plugin: String,
    pub intf: String,
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

impl GuestPluginRef for PluginRef {
    fn new(service: String, plugin: String, intf: String) -> Self {
        PluginRef {
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
