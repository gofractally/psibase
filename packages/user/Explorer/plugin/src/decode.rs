use std::collections::HashMap;

use psibase::fracpack::CompiledSchema;
use psibase::{schema_types, Hex, MethodString, Schema};
use serde_json::Value;

use crate::bindings::packages::plugin::queries::get_schema;

/// Decodes action payloads with the schemas of the services that receive them.
/// Each service's schema is fetched at most once per decoder.
#[derive(Default)]
pub struct ActionDecoder {
    schemas: HashMap<String, Option<Schema>>,
}

impl ActionDecoder {
    fn schema(&mut self, service: &str) -> Option<&Schema> {
        self.schemas
            .entry(service.to_string())
            .or_insert_with(|| {
                get_schema(service)
                    .ok()
                    .flatten()
                    .and_then(|json| serde_json::from_str(&json).ok())
            })
            .as_ref()
    }

    fn decode(&mut self, service: &str, method: &str, raw_data: &str) -> Option<Value> {
        let schema = self.schema(service)?;
        let action = schema.actions.get(&MethodString(method.to_string()))?;
        let data: Hex<Vec<u8>> = raw_data.parse().ok()?;
        let custom = schema_types();
        let mut cschema = CompiledSchema::new(&schema.types, &custom);
        cschema.extend(&action.params);
        cschema
            .to_value(&action.params, &data.0)
            .ok()
            .filter(|value| !value.is_null())
    }

    /// Sets `data` on each action in a JSON array of `{ service, method, rawData }` objects
    /// whose payload can be decoded. Other actions are left unchanged.
    pub fn decode_actions(&mut self, actions: &mut Value) {
        let Some(actions) = actions.as_array_mut() else {
            return;
        };
        for action in actions {
            let fields = (
                action["service"].as_str(),
                action["method"].as_str(),
                action["rawData"].as_str(),
            );
            let (Some(service), Some(method), Some(raw_data)) = fields else {
                continue;
            };
            let (service, method, raw_data) =
                (service.to_string(), method.to_string(), raw_data.to_string());
            if let Some(data) = self.decode(&service, &method, &raw_data) {
                action["data"] = data;
            }
        }
    }
}
