use async_trait::async_trait;
use psibase::{AccountNumber, Action, ActionFormatter, Schema, SchemaFetcher, SharedAction};
use serde::Deserialize;
use serde_json::Value;

use crate::bindings::packages::plugin::queries::get_schema;

struct PluginSchemaFetcher;

#[async_trait(?Send)]
impl SchemaFetcher for PluginSchemaFetcher {
    async fn fetch_schema(&self, service: AccountNumber) -> Result<Schema, anyhow::Error> {
        let json = get_schema(&service.to_string())?
            .ok_or_else(|| anyhow::anyhow!("{service} has no schema"))?;
        Ok(serde_json::from_str(&json)?)
    }
}

/// Decodes action payloads, and the actions nested in them, with the schemas of the
/// services that receive them. Each service's schema is fetched at most once per decoder.
pub struct ActionDecoder {
    formatter: ActionFormatter<'static, PluginSchemaFetcher>,
}

impl Default for ActionDecoder {
    fn default() -> Self {
        Self {
            formatter: ActionFormatter::new(PluginSchemaFetcher),
        }
    }
}

impl ActionDecoder {
    /// Sets `data` on each action in a JSON array of `{ sender, service, method, rawData }`
    /// objects whose payload can be decoded, and restores the original spelling of hashed
    /// method names. Other actions are left unchanged.
    pub async fn decode_actions(&self, actions: &mut Value) {
        let Some(actions) = actions.as_array_mut() else {
            return;
        };
        for action in actions {
            let Ok(parsed) = Action::deserialize(&*action) else {
                continue;
            };
            let shared = SharedAction {
                sender: parsed.sender,
                service: parsed.service,
                method: parsed.method,
                rawData: (&parsed.rawData.0[..]).into(),
            };
            self.formatter.prepare_action(shared.clone()).await;
            let (method, data) = self.formatter.unpack_action(shared);
            action["method"] = method.0.into();
            if let Some(data) = data.filter(|data| !data.is_null()) {
                action["data"] = data;
            }
        }
    }
}
