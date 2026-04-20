use std::fmt;

use crate::{
    method, schema_types,
    services::{db, transact},
    AccountNumber, Action, Hex, MethodNumber, MethodString, Pack, Schema, SchemaMap,
};
use anyhow::anyhow;
use async_trait::async_trait;
use fracpack::{CompiledSchema, Unpack};
use futures::future::{FutureExt, LocalBoxFuture, Shared};
use serde::{
    ser::{SerializeSeq, SerializeStruct},
    Deserialize, Serialize, Serializer,
};
use serde_aux::prelude::deserialize_number_from_string;
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::io::Write;
use std::rc::Rc;

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
    pub fn write_json<'a, F: SchemaFetcher + 'a, W: Write>(
        &self,
        afmt: &ActionFormatter<F>,
        writer: W,
    ) -> serde_json::Result<()> {
        serde_json::to_writer(
            writer,
            &UnpackedTrace {
                value: self,
                schemas: &afmt.storage.schemas.borrow(),
            },
        )
    }
    pub fn write_json_pretty<'a, F: SchemaFetcher + 'a, W: Write>(
        &self,
        afmt: &ActionFormatter<F>,
        writer: W,
    ) -> serde_json::Result<()> {
        serde_json::to_writer_pretty(
            writer,
            &UnpackedTrace {
                value: self,
                schemas: &afmt.storage.schemas.borrow(),
            },
        )
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

fn decode_into_value<'a>(
    cschema: &mut CompiledSchema<'a>,
    ty: &'a fracpack::AnyType,
    raw: &[u8],
) -> Option<serde_json::Value> {
    cschema.extend(ty);
    cschema.to_value(ty, raw).ok()
}

/// Decode an action's `rawData` into a JSON value using the provided service schema.
pub fn unpack_action_data(
    schema: &Schema,
    method: &MethodNumber,
    raw_data: &[u8],
) -> Option<serde_json::Value> {
    if raw_data.is_empty() {
        return None;
    }
    let action_name = MethodString(method.to_string());
    let action_type = schema.actions.get(&action_name)?;
    let custom = schema_types();
    let mut cschema = CompiledSchema::new(&schema.types, &custom);
    decode_into_value(&mut cschema, &action_type.params, raw_data)
}

pub struct PrunedJson<'a>(pub &'a serde_json::Value);

impl fmt::Display for PrunedJson<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        format_pruned_json(f, self.0)
    }
}

pub struct PrunedJsonPretty<'a>(pub &'a serde_json::Value);

impl fmt::Display for PrunedJsonPretty<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        format_pruned_json_pretty(f, self.0)
    }
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
            if let Some(args) =
                decode_into_value(&mut cschema, &action_type.params, &atrace.action.rawData)
            {
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
                write!(f, "{:indent$}    retval: ", "",)?;
                if let Some(result) =
                    decode_into_value(&mut cschema, result_type, &atrace.raw_retval)
                {
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

fn format_error_stack<T: std::fmt::Write>(
    schemas: &SchemaMap,
    atrace: &ActionTrace,
    f: &mut T,
) -> fmt::Result {
    if atrace.error.is_some() {
        let schema = schemas.get(&atrace.action.service);
        let action_name = MethodString(atrace.action.method.to_string());
        let action_name = schema
            .and_then(|schema| schema.actions.get_key_value(&action_name))
            .map_or(&action_name, |(name, _action_type)| name);
        writeln!(
            f,
            "{} => {}::{}",
            atrace.action.sender, atrace.action.service, action_name
        )?;
        for inner in &atrace.inner_traces {
            match &inner.inner {
                InnerTraceEnum::ConsoleTrace(_) => (),
                InnerTraceEnum::EventTrace(_) => (),
                InnerTraceEnum::ActionTrace(a) => format_error_stack(schemas, a, f)?,
            }
        }
    }
    Ok(())
}

fn format_transaction_error_stack<T: std::fmt::Write>(
    schemas: &SchemaMap,
    ttrace: &TransactionTrace,
    f: &mut T,
) -> fmt::Result {
    for a in &ttrace.action_traces {
        format_error_stack(schemas, a, f)?;
        break;
    }
    if let Some(message) = &ttrace.error {
        writeln!(f, "{}", message)?;
    }
    Ok(())
}

impl TransactionTrace {
    pub fn fmt_stack<'a, F: SchemaFetcher + 'a>(&self, afmt: &ActionFormatter<'a, F>) -> String {
        let mut result = String::new();
        format_transaction_error_stack(&afmt.storage.schemas.borrow(), self, &mut result).unwrap();
        result
    }
}

#[async_trait(?Send)]
pub trait SchemaFetcher {
    async fn fetch_schema(&self, service: AccountNumber) -> Result<Schema, anyhow::Error>;
}

pub struct DisplayTransactionTrace<'a> {
    schemas: &'a RefCell<HashMap<AccountNumber, Schema>>,
    trace: &'a TransactionTrace,
}

impl fmt::Display for DisplayTransactionTrace<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        format_transaction_trace(&self.schemas.borrow(), self.trace, 0, f)
    }
}

type PinType<'a> = LocalBoxFuture<'a, Result<(), Rc<Cell<anyhow::Error>>>>;

struct ActionFormatterImpl<'a, F: SchemaFetcher + 'a> {
    schemas: RefCell<HashMap<AccountNumber, Schema>>,
    fetcher: F,
    pending: RefCell<HashMap<AccountNumber, Shared<PinType<'a>>>>,
}

pub struct ActionFormatter<'a, F: SchemaFetcher + 'a> {
    storage: Rc<ActionFormatterImpl<'a, F>>,
}

impl<'a, F: SchemaFetcher + 'a> ActionFormatter<'a, F> {
    pub fn with_schemas(schemas: SchemaMap, fetcher: F) -> Self {
        ActionFormatter {
            storage: Rc::new(ActionFormatterImpl {
                schemas: schemas.into(),
                fetcher,
                pending: RefCell::new(HashMap::new()),
            }),
        }
    }
    pub fn new(fetcher: F) -> Self {
        Self::with_schemas(HashMap::new(), fetcher)
    }
    pub async fn add_service(&self, service: AccountNumber) -> Result<(), anyhow::Error> {
        if !self.storage.schemas.borrow().contains_key(&service) {
            let fut = self
                .storage
                .pending
                .borrow_mut()
                .entry(service)
                .or_insert_with(|| {
                    let storage = self.storage.clone();
                    let fut: PinType = Box::pin(async move {
                        let schema = storage
                            .fetcher
                            .fetch_schema(service)
                            .await
                            .map_err(|e| Rc::new(Cell::new(e)))?;
                        storage.schemas.borrow_mut().insert(service, schema);
                        Ok(())
                    });
                    fut.shared()
                })
                .clone();
            if let Err(e) = fut.await {
                Err(e.replace(anyhow!("Failed to fetch schema")))?
            }
        }
        Ok(())
    }
    pub async fn prepare_event_trace(&self, _etrace: &EventTrace) -> Result<(), anyhow::Error> {
        Ok(())
    }
    pub async fn prepare_action_trace(&self, atrace: &ActionTrace) -> Result<(), anyhow::Error> {
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
        &self,
        ttrace: &TransactionTrace,
    ) -> Result<(), anyhow::Error> {
        let mut res = Ok(());
        for a in &ttrace.action_traces {
            res = res.and(self.prepare_action_trace(a).await)
        }
        res
    }
    pub async fn prepare_error_stack(&self, atrace: &ActionTrace) -> Result<(), anyhow::Error> {
        if atrace.error.is_some() {
            let mut res = self.add_service(atrace.action.service).await;
            for inner in &atrace.inner_traces {
                match &inner.inner {
                    InnerTraceEnum::ActionTrace(a) => {
                        res = res.and(Box::pin(self.prepare_error_stack(a)).await)
                    }
                    _ => {}
                }
            }
            res
        } else {
            Ok(())
        }
    }
    pub async fn prepare_transaction_error_stack(
        &self,
        ttrace: &TransactionTrace,
    ) -> Result<(), anyhow::Error> {
        let mut res = Ok(());
        for a in &ttrace.action_traces {
            res = res.and(self.prepare_error_stack(a).await);
        }
        res
    }
    pub fn display_transaction_trace<'b>(
        &'b self,
        ttrace: &'b TransactionTrace,
    ) -> DisplayTransactionTrace<'b> {
        DisplayTransactionTrace {
            schemas: &self.storage.schemas,
            trace: ttrace,
        }
    }
}

#[derive(Copy, Clone)]
struct PruneStyle {
    indent: Option<usize>,
}

impl PruneStyle {
    const COMPACT: Self = Self { indent: None };
    const PRETTY: Self = Self { indent: Some(0) };

    fn child(self) -> Self {
        Self {
            indent: self.indent.map(|d| d + 2),
        }
    }

    fn write_break(self, w: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(d) = self.indent {
            write!(w, "\n{:width$}", "", width = d)?;
        }
        Ok(())
    }
}

fn format_truncated_list<T, L, F>(
    writer: &mut fmt::Formatter<'_>,
    value: L,
    len: usize,
    style: PruneStyle,
    mut f: F,
) -> fmt::Result
where
    L: IntoIterator<Item = T>,
    F: FnMut(&mut fmt::Formatter<'_>, T) -> fmt::Result,
{
    let child = style.child();
    let mut any = false;
    for (i, item) in value.into_iter().enumerate() {
        if i != 0 {
            write!(writer, ",")?;
        }
        child.write_break(writer)?;
        any = true;
        if i >= len {
            write!(writer, "…")?;
            break;
        }
        f(writer, item)?;
    }
    if any {
        style.write_break(writer)?;
    }
    Ok(())
}

fn format_pruned_json_inner(
    writer: &mut fmt::Formatter<'_>,
    value: &serde_json::Value,
    style: PruneStyle,
) -> fmt::Result {
    use serde_json::Value::*;
    match value {
        String(s) if s.len() > 20 => {
            let end = s
                .char_indices()
                .map(|(i, _)| i)
                .find(|i| *i >= 20)
                .unwrap_or(s.len());
            write!(
                writer,
                "{}",
                serde_json::to_string(&(s[..end].to_string() + "…")).unwrap()
            )?;
        }
        Array(a) => {
            let child = style.child();
            write!(writer, "[")?;
            format_truncated_list(writer, a, 5, style, |w, item| {
                format_pruned_json_inner(w, item, child)
            })?;
            write!(writer, "]")?;
        }
        Object(a) => {
            let child = style.child();
            let kv_sep = if style.indent.is_some() { ": " } else { ":" };
            write!(writer, "{{")?;
            format_truncated_list(writer, a, 5, style, |w, (k, v)| {
                write!(w, "{}{}", serde_json::to_string(k).unwrap(), kv_sep)?;
                format_pruned_json_inner(w, v, child)
            })?;
            write!(writer, "}}")?;
        }
        value => write!(writer, "{}", serde_json::to_string(value).unwrap())?,
    }
    Ok(())
}

fn format_pruned_json(
    writer: &mut fmt::Formatter<'_>,
    value: &serde_json::Value,
) -> fmt::Result {
    format_pruned_json_inner(writer, value, PruneStyle::COMPACT)
}

fn format_pruned_json_pretty(
    writer: &mut fmt::Formatter<'_>,
    value: &serde_json::Value,
) -> fmt::Result {
    format_pruned_json_inner(writer, value, PruneStyle::PRETTY)
}

struct UnpackedAction<'a> {
    value: &'a Action,
    method: &'a MethodString,
    data: Option<serde_json::Value>,
}

impl<'a> Serialize for UnpackedAction<'a> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("Action", 4)?;
        s.serialize_field("sender", &self.value.sender)?;
        s.serialize_field("service", &self.value.service)?;
        s.serialize_field("method", self.method)?;
        if let Some(data) = &self.data {
            s.serialize_field("data", data)?;
        } else {
            s.serialize_field("rawData", &self.value.rawData)?;
        }
        s.end()
    }
}

struct UnpackedTrace<'a, T> {
    value: T,
    schemas: &'a SchemaMap,
}

impl<'a, 'b, T> Serialize for UnpackedTrace<'a, &'b Vec<T>>
where
    UnpackedTrace<'a, &'b T>: Serialize,
{
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_seq(Some(self.value.len()))?;
        for item in self.value {
            s.serialize_element(&UnpackedTrace {
                value: item,
                schemas: self.schemas,
            })?
        }
        s.end()
    }
}

impl<'a, 'b> Serialize for UnpackedTrace<'a, &'b TransactionTrace> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("TransactionTrace", 2)?;
        s.serialize_field(
            "actionTraces",
            &UnpackedTrace {
                value: &self.value.action_traces,
                schemas: self.schemas,
            },
        )?;
        s.serialize_field("error", &self.value.error)?;
        s.end()
    }
}

impl<'a, 'b> Serialize for UnpackedTrace<'a, &'b ActionTrace> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let atrace = &self.value;
        let schema = self.schemas.get(&atrace.action.service);
        let action_name = MethodString(atrace.action.method.to_string());
        let (action_name, action_type) = schema
            .and_then(|schema| schema.actions.get_key_value(&action_name))
            .map_or((&action_name, None), |(name, action_type)| {
                (name, Some(action_type))
            });

        let mut unpacked_args = None;
        let mut unpacked_retval = None;

        if let Some(action_type) = action_type {
            let custom = schema_types();
            let mut cschema = CompiledSchema::new(&schema.unwrap().types, &custom);
            if !atrace.action.rawData.is_empty() {
                unpacked_args =
                    decode_into_value(&mut cschema, &action_type.params, &atrace.action.rawData);
            }
            if !atrace.raw_retval.is_empty() {
                if let Some(result_type) = &action_type.result {
                    unpacked_retval =
                        decode_into_value(&mut cschema, result_type, &atrace.raw_retval);
                }
            }
        }

        let mut s = serializer.serialize_struct("ActionTrace", 5)?;

        s.serialize_field(
            "action",
            &UnpackedAction {
                value: &self.value.action,
                method: action_name,
                data: unpacked_args,
            },
        )?;

        if let Some(unpacked_retval) = unpacked_retval {
            s.serialize_field("retval", &unpacked_retval)?;
        } else {
            s.serialize_field("rawRetval", &self.value.raw_retval)?;
        }

        s.serialize_field(
            "innerTraces",
            &UnpackedTrace {
                value: &self.value.inner_traces,
                schemas: self.schemas,
            },
        )?;
        s.serialize_field("totalTime", &self.value.total_time)?;
        s.serialize_field("error", &self.value.error)?;
        s.end()
    }
}

impl<'a, 'b> Serialize for UnpackedTrace<'a, &'b InnerTrace> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("InnerTrace", 1)?;
        s.serialize_field(
            "inner",
            &UnpackedTrace {
                value: &self.value.inner,
                schemas: self.schemas,
            },
        )?;
        s.end()
    }
}

impl<'a, 'b> Serialize for UnpackedTrace<'a, &'b InnerTraceEnum> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.value {
            InnerTraceEnum::ConsoleTrace(trace) => {
                serializer.serialize_newtype_variant("InnerTraceEnum", 0, "ConsoleTrace", trace)
            }
            InnerTraceEnum::EventTrace(trace) => {
                serializer.serialize_newtype_variant("InnerTraceEnum", 1, "EventTrace", trace)
            }
            InnerTraceEnum::ActionTrace(trace) => serializer.serialize_newtype_variant(
                "InnerTraceEnum",
                2,
                "ActionTrace",
                &UnpackedTrace {
                    value: trace,
                    schemas: self.schemas,
                },
            ),
        }
    }
}
