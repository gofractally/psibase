use std::fmt;

use crate::{
    method, schema_types,
    services::{db, transact},
    AccountNumber, Action, Hex, MethodString, Pack, Schema, SchemaMap,
};
use async_trait::async_trait;
use fracpack::{CompiledSchema, Unpack};
use serde::{Deserialize, Serialize};
use serde_aux::prelude::deserialize_number_from_string;
use std::collections::HashMap;

#[derive(Debug, Clone, Pack, Unpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[serde(rename_all = "camelCase")]
pub struct ActionTrace {
    pub action: Action,
    pub raw_retval: Hex<Vec<u8>>,
    pub inner_traces: Vec<InnerTrace>,
    #[serde(deserialize_with = "deserialize_number_from_string")]
    pub total_time: i64,
    pub error: Option<String>,
}

impl fmt::Display for ActionTrace {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        format_action_trace(&SchemaMap::new(), self, 0, f)
    }
}

#[derive(Debug, Clone, Pack, Unpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[serde(rename_all = "camelCase")]
pub struct EventTrace {
    pub name: String,
    pub data: Hex<Vec<u8>>,
}

#[derive(Debug, Clone, Pack, Unpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[serde(rename_all = "camelCase")]
pub struct ConsoleTrace {
    pub console: String,
}

#[derive(Debug, Clone, Pack, Unpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub enum InnerTraceEnum {
    ConsoleTrace(ConsoleTrace),
    EventTrace(EventTrace),
    ActionTrace(ActionTrace),
}

#[derive(Debug, Clone, Pack, Unpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[serde(rename_all = "camelCase")]
pub struct InnerTrace {
    pub inner: InnerTraceEnum,
}

#[derive(Debug, Clone, Pack, Unpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[serde(rename_all = "camelCase")]
pub struct TransactionTrace {
    pub action_traces: Vec<ActionTrace>,
    pub error: Option<String>,
}

impl TransactionTrace {
    pub fn ok(self) -> Result<TransactionTrace, anyhow::Error> {
        if let Some(e) = self.error {
            Err(anyhow::anyhow!("{}", e))
        } else {
            Ok(self)
        }
    }

    pub fn match_error(self, msg: &str) -> Result<TransactionTrace, anyhow::Error> {
        if let Some(e) = &self.error {
            if e.contains(msg) {
                Ok(self)
            } else {
                Err(anyhow::anyhow!(
                    "Transaction was expected to fail with \"{}\", but failed with \"{}\"",
                    msg,
                    e
                ))
            }
        } else {
            Err(anyhow::anyhow!(
                "Transaction was expected to fail with \"{}\", but succeeded",
                msg,
            ))
        }
    }
    pub fn console(&self) -> TraceConsole<'_> {
        return TraceConsole { trace: self };
    }
}

impl fmt::Display for TransactionTrace {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        format_transaction_trace(&SchemaMap::new(), self, 0, f)
    }
}

pub struct TraceConsole<'a> {
    trace: &'a TransactionTrace,
}

impl fmt::Display for TraceConsole<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for atrace in &self.trace.action_traces {
            write_action_console(atrace, f)?;
        }
        Ok(())
    }
}

fn write_action_console(atrace: &ActionTrace, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    for inner in &atrace.inner_traces {
        match &inner.inner {
            InnerTraceEnum::ConsoleTrace(c) => write!(f, "{}", &c.console)?,
            InnerTraceEnum::EventTrace(_) => {}
            InnerTraceEnum::ActionTrace(a) => write_action_console(a, f)?,
        }
    }
    Ok(())
}

fn format_string(mut s: &str, indent: usize, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    while let Some(nl) = s.find('\n') {
        write!(f, "{}", &s[..nl])?;
        s = &s[nl + 1..];
        if !s.is_empty() {
            write!(f, "\n{:indent$}", "")?;
        }
    }
    write!(f, "{}", s)
}

fn format_console(c: &ConsoleTrace, indent: usize, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "{:indent$}console:    ", "")?;
    format_string(&c.console, indent + 12, f)
}

fn format_event(_: &EventTrace, indent: usize, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    writeln!(f, "{:indent$}event", "")
}

fn hide_action(action: &Action) -> bool {
    use crate as psibase;
    action.service == db::SERVICE && action.method == method!("open")
        || action.service == transact::SERVICE && action.method == method!("kvNotify")
}

fn format_action_trace(
    schemas: &SchemaMap,
    atrace: &ActionTrace,
    indent: usize,
    f: &mut fmt::Formatter<'_>,
) -> fmt::Result {
    if hide_action(&atrace.action) {
        return Ok(());
    }
    let schema = schemas.get(&atrace.action.service);
    let action_name = MethodString(atrace.action.method.to_string());
    let (action_name, action_type) = schema
        .and_then(|schema| schema.actions.get_key_value(&action_name))
        .map_or((&action_name, None), |(name, action_type)| {
            (name, Some(action_type))
        });

    writeln!(f, "{:indent$}action:", "")?;
    writeln!(
        f,
        "{:indent$}    {} => {}::{}",
        "", atrace.action.sender, atrace.action.service, action_name
    )?;
    if let Some(action_type) = action_type {
        let custom = schema_types();
        let mut cschema = CompiledSchema::new(&schema.unwrap().types, &custom);
        if !atrace.action.rawData.is_empty() {
            cschema.extend(&action_type.params);
            if let Ok(args) = cschema.to_value(&action_type.params, &atrace.action.rawData) {
                if let serde_json::Value::Object(args) = args {
                    for (name, value) in args {
                        write!(f, "{:indent$}    {}: ", "", name)?;
                        format_pruned_json(f, &value)?;
                        writeln!(f, "")?;
                    }
                } else {
                    write!(f, "{:indent$}    args: ", "")?;
                    format_pruned_json(f, &args)?;
                    writeln!(f, "")?;
                }
            } else {
                writeln!(f, "{:indent$}    args: <deserialization failed>", "")?;
            }
        }
        if !atrace.raw_retval.is_empty() {
            if let Some(result_type) = &action_type.result {
                cschema.extend(result_type);
                write!(f, "{:indent$}    retval: ", "",)?;
                if let Ok(result) = &cschema.to_value(result_type, &atrace.raw_retval) {
                    format_pruned_json(f, &result)?
                } else {
                    write!(f, "<deserialization failed>")?
                }
                writeln!(f, "")?;
            }
        }
    } else {
        writeln!(
            f,
            "{:indent$}    raw_retval: {} bytes",
            "",
            atrace.raw_retval.len()
        )?;
    }
    for inner in &atrace.inner_traces {
        match &inner.inner {
            InnerTraceEnum::ConsoleTrace(c) => format_console(c, indent + 4, f)?,
            InnerTraceEnum::EventTrace(e) => format_event(e, indent + 4, f)?,
            InnerTraceEnum::ActionTrace(a) => format_action_trace(schemas, a, indent + 4, f)?,
        }
    }
    Ok(())
}

fn format_transaction_trace(
    schemas: &SchemaMap,
    ttrace: &TransactionTrace,
    indent: usize,
    f: &mut fmt::Formatter<'_>,
) -> fmt::Result {
    for a in &ttrace.action_traces {
        format_action_trace(schemas, a, indent, f)?;
    }
    if let Some(e) = &ttrace.error {
        write!(f, "{:indent$}error:     ", "")?;
        format_string(e, indent + 11, f)?;
    }
    Ok(())
}

fn format_error_stack<T: std::fmt::Write>(atrace: &ActionTrace, f: &mut T) -> fmt::Result {
    if atrace.error.is_some() {
        writeln!(
            f,
            "{} => {}::{}",
            atrace.action.sender, atrace.action.service, atrace.action.method
        )?;
        for inner in &atrace.inner_traces {
            match &inner.inner {
                InnerTraceEnum::ConsoleTrace(_) => (),
                InnerTraceEnum::EventTrace(_) => (),
                InnerTraceEnum::ActionTrace(a) => format_error_stack(a, f)?,
            }
        }
    }
    Ok(())
}

fn format_transaction_error_stack<T: std::fmt::Write>(
    ttrace: &TransactionTrace,
    f: &mut T,
) -> fmt::Result {
    for a in &ttrace.action_traces {
        format_error_stack(a, f)?;
        break;
    }
    if let Some(message) = &ttrace.error {
        writeln!(f, "{}", message)?;
    }
    Ok(())
}

impl TransactionTrace {
    pub fn fmt_stack(&self) -> String {
        let mut result = String::new();
        format_transaction_error_stack(self, &mut result).unwrap();
        result
    }
}

#[async_trait(?Send)]
pub trait SchemaFetcher {
    async fn fetch_schema(&self, service: AccountNumber) -> Result<Schema, anyhow::Error>;
}

pub struct DisplayTransactionTrace<'a> {
    schemas: &'a HashMap<AccountNumber, Schema>,
    trace: &'a TransactionTrace,
}

impl fmt::Display for DisplayTransactionTrace<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        format_transaction_trace(self.schemas, self.trace, 0, f)
    }
}

pub struct ActionFormatter<F: SchemaFetcher> {
    schemas: HashMap<AccountNumber, Schema>,
    fetcher: F,
}

impl<F: SchemaFetcher> ActionFormatter<F> {
    pub fn with_schemas(schemas: SchemaMap, fetcher: F) -> Self {
        ActionFormatter { schemas, fetcher }
    }
    pub fn new(fetcher: F) -> Self {
        ActionFormatter {
            schemas: HashMap::new(),
            fetcher,
        }
    }
    pub async fn add_service(&mut self, service: AccountNumber) -> Result<(), anyhow::Error> {
        use std::collections::hash_map::Entry::*;
        match self.schemas.entry(service) {
            Occupied(_) => {}
            Vacant(entry) => {
                entry.insert(self.fetcher.fetch_schema(service).await?);
            }
        }
        Ok(())
    }
    pub async fn prepare_event_trace(&mut self, _etrace: &EventTrace) -> Result<(), anyhow::Error> {
        Ok(())
    }
    pub async fn prepare_action_trace(
        &mut self,
        atrace: &ActionTrace,
    ) -> Result<(), anyhow::Error> {
        let mut res = self.add_service(atrace.action.service).await;
        for inner in &atrace.inner_traces {
            match &inner.inner {
                InnerTraceEnum::EventTrace(e) => res = res.and(self.prepare_event_trace(e).await),
                InnerTraceEnum::ActionTrace(a) => {
                    res = res.and(Box::pin(self.prepare_action_trace(a)).await)
                }
                _ => {}
            }
        }
        res
    }
    pub async fn prepare_transaction_trace(
        &mut self,
        ttrace: &TransactionTrace,
    ) -> Result<(), anyhow::Error> {
        let mut res = Ok(());
        for a in &ttrace.action_traces {
            res = res.and(self.prepare_action_trace(a).await)
        }
        res
    }
    pub fn display_transaction_trace<'a>(
        &'a self,
        ttrace: &'a TransactionTrace,
    ) -> DisplayTransactionTrace<'a> {
        DisplayTransactionTrace {
            schemas: &self.schemas,
            trace: ttrace,
        }
    }
}

fn format_truncated_list<
    T,
    L: IntoIterator<Item = T>,
    F: Fn(&mut fmt::Formatter<'_>, T) -> fmt::Result,
>(
    writer: &mut fmt::Formatter<'_>,
    value: L,
    len: usize,
    f: F,
) -> fmt::Result {
    for (i, item) in value.into_iter().enumerate() {
        if i != 0 {
            write!(writer, ",")?;
        }
        if i >= len {
            write!(writer, "…")?;
            break;
        }
        f(writer, item)?
    }
    Ok(())
}

fn format_pruned_json(
    writer: &mut fmt::Formatter<'_>,
    value: &serde_json::Value,
) -> std::fmt::Result {
    use serde_json::Value::*;
    match value {
        String(s) if s.len() > 20 => {
            write!(
                writer,
                "{}",
                serde_json::to_string(&(s[..s.ceil_char_boundary(20)].to_string() + "…")).unwrap()
            )?;
        }
        Array(a) => {
            write!(writer, "[")?;
            format_truncated_list(writer, a, 5, |writer, item| {
                format_pruned_json(writer, item)
            })?;
            write!(writer, "]")?;
        }
        Object(a) => {
            write!(writer, "{{")?;
            format_truncated_list(writer, a, 5, |writer, (k, v)| {
                write!(writer, "{}:", serde_json::to_string(k).unwrap())?;
                format_pruned_json(writer, v)
            })?;
            write!(writer, "}}")?;
        }
        value => write!(writer, "{}", serde_json::to_string(value).unwrap())?,
    }
    Ok(())
}
