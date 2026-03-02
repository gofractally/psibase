use crate::tables::tables::ParsedFunctions;
use serde::Serialize;

#[derive(Serialize)]
pub struct PluginDepsResponse {
    pub plugins: std::collections::HashMap<String, PluginInfoEntry>,
}

#[derive(Serialize)]
pub struct PluginInfoEntry {
    #[serde(rename = "importedFuncs")]
    pub importedFuncs: ParsedFunctions,
    #[serde(rename = "exportedFuncs")]
    pub exportedFuncs: ParsedFunctions,
    pub deps: Vec<String>,
}
