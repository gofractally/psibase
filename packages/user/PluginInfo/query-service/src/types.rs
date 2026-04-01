use crate::ParsedFunctions;
use async_graphql::{InputObject, SimpleObject};
use psibase::AccountNumber;

#[derive(SimpleObject)]
pub(crate) struct PluginDepsResponse {
    pub(crate) plugins: Vec<PluginDep>,
}

#[derive(SimpleObject)]
pub(crate) struct PluginDep {
    pub(crate) plugin_key: String,
    pub(crate) info: PluginInfo,
}

#[derive(SimpleObject)]
pub(crate) struct PluginInfo {
    pub(crate) importedFuncs: ParsedFunctions,
    pub(crate) exportedFuncs: ParsedFunctions,
    pub(crate) deps: Vec<String>,
}

#[derive(InputObject)]
pub(crate) struct PluginSpec {
    pub(crate) service: AccountNumber,
    pub(crate) plugin: String,
}
