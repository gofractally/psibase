use crate::{psibase, Action, Fracpack};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionTrace {
    pub action: Action,
    pub raw_retval: Vec<u8>,
    pub inner_traces: Vec<InnerTrace>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventTrace {
    pub name: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleTrace {
    pub console: String,
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
pub enum InnerTraceEnum {
    ConsoleTrace(ConsoleTrace),
    EventTrace(EventTrace),
    ActionTrace(ActionTrace),
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InnerTrace {
    pub inner: InnerTraceEnum,
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionTrace {
    pub action_traces: Vec<ActionTrace>,
    pub error: Option<String>,
}
