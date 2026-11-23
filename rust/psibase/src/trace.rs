use std::fmt;

use crate::{
    method, nested_calls,
    services::{db, transact, virtual_server},
    AccountNumber, Action, ActionDecoder, SchemaMap, ServiceSchema,
};
use anyhow::anyhow;
use async_trait::async_trait;

use futures::future::{FutureExt, LocalBoxFuture, Shared};
use serde::{
    ser::{SerializeSeq, SerializeStruct}, Serialize, Serializer,
};
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::rc::Rc;
use std::sync::Arc;

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
#[serde(rename_all = "camelCase")]
pub struct ActionTrace {
    pub action: Action,
    pub raw_retval: Vec<u8>,
    pub inner_traces: Vec<InnerTrace>,
    pub total_time: psio::time::Duration<psio::time::Nanos>,
    pub error: Option<psio::pssz::RawString>,
}

impl ActionTrace {
    /// The error as text; bytes that are not UTF-8 are replaced.
    pub fn error_text(&self) -> Option<String> {
        self.error
            .as_ref()
            .map(|e| e.to_string())
    }
}

impl fmt::Display for ActionTrace {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        format_action_trace(&ActionDecoder::empty(), self, 0, f)
    }
}

#[derive(
    Debug,
    Clone,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleTrace {
    pub console: psio::pssz::RawString,
}

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub enum InnerTraceEnum {
    ConsoleTrace(ConsoleTrace),
    ActionTrace(ActionTrace),
}

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
#[serde(rename_all = "camelCase")]
pub struct InnerTrace {
    pub inner: InnerTraceEnum,
}

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
#[serde(rename_all = "camelCase")]
pub struct TransactionTrace {
    pub action_traces: Vec<ActionTrace>,
    pub error: Option<psio::pssz::RawString>,
}

impl TransactionTrace {
    /// The error as text. It is whatever the failing service passed to
    /// abort: bytes that are not UTF-8 are replaced.
    pub fn error_text(&self) -> Option<String> {
        self.error
            .as_ref()
            .map(|e| e.to_string())
    }

    #[track_caller]
    pub fn ok(self) -> Result<TransactionTrace, anyhow::Error> {
        if let Some(e) = self.error_text() {
            let loc = std::panic::Location::caller();
            Err(anyhow::anyhow!("{} (at {}:{})", e, loc.file(), loc.line()))
        } else {
            Ok(self)
        }
    }

    #[track_caller]
    pub fn match_error(self, msg: &str) -> Result<TransactionTrace, anyhow::Error> {
        let loc = std::panic::Location::caller();
        if let Some(e) = self.error_text() {
            if e.contains(msg) {
                Ok(self)
            } else {
                Err(anyhow::anyhow!(
                    "Transaction was expected to fail with \"{}\", but failed with \"{}\" (at {}:{})",
                    msg,
                    e,
                    loc.file(),
                    loc.line()
                ))
            }
        } else {
            Err(anyhow::anyhow!(
                "Transaction was expected to fail with \"{}\", but succeeded (at {}:{})",
                msg,
                loc.file(),
                loc.line()
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
                schemas: &afmt.decoder(),
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
                schemas: &afmt.decoder(),
            },
        )
    }
}

impl fmt::Display for TransactionTrace {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        format_transaction_trace(&ActionDecoder::empty(), self, 0, f)
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
            InnerTraceEnum::ConsoleTrace(c) => {
                write!(f, "{}", c.console.to_string_lossy())?
            }
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
    format_string(&c.console.to_string_lossy(), indent + 12, f)?;
    writeln!(f)
}

fn hide_action(action: &Action) -> bool {
    use crate as psibase;
    action.service == db::SERVICE && action.method == method!("open")
        || action.service == transact::SERVICE && action.method == method!("kvNotify")
}

fn format_action_trace(
    schemas: &ActionDecoder,
    atrace: &ActionTrace,
    indent: usize,
    f: &mut fmt::Formatter<'_>,
) -> fmt::Result {
    if hide_action(&atrace.action) {
        return Ok(());
    }
    let action_name = schemas.method_name(atrace.action.service, atrace.action.method);

    writeln!(f, "{:indent$}action:", "")?;
    writeln!(
        f,
        "{:indent$}    {} => {}::{}",
        "", atrace.action.sender, atrace.action.service, action_name
    )?;
    if schemas.describes(atrace.action.service, atrace.action.method) {
        if !atrace.action.rawData.is_empty() {
            match schemas.args(&atrace.action) {
                Some(Ok(serde_json::Value::Object(args))) => {
                    for (name, value) in args {
                        write!(f, "{:indent$}    {}: ", "", name)?;
                        format_pruned_json(f, &value)?;
                        writeln!(f, "")?;
                    }
                }
                Some(Ok(args)) => {
                    write!(f, "{:indent$}    args: ", "")?;
                    format_pruned_json(f, &args)?;
                    writeln!(f, "")?;
                }
                _ => writeln!(f, "{:indent$}    args: <deserialization failed>", "")?,
            }
        }
        if !atrace.raw_retval.is_empty() {
            if let Some(result) = schemas.retval(
                atrace.action.service,
                atrace.action.method,
                &atrace.raw_retval,
            ) {
                write!(f, "{:indent$}    retval: ", "",)?;
                if let Ok(result) = &result {
                    format_pruned_json(f, result)?
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
            InnerTraceEnum::ActionTrace(a) => format_action_trace(schemas, a, indent + 4, f)?,
        }
    }
    Ok(())
}

fn format_transaction_trace(
    schemas: &ActionDecoder,
    ttrace: &TransactionTrace,
    indent: usize,
    f: &mut fmt::Formatter<'_>,
) -> fmt::Result {
    for a in &ttrace.action_traces {
        format_action_trace(schemas, a, indent, f)?;
    }
    if let Some(e) = ttrace.error_text() {
        write!(f, "{:indent$}error:     ", "")?;
        format_string(&e, indent + 11, f)?;
    }
    Ok(())
}

fn use_disk_sys_amount(action: &Action) -> Option<i64> {
    use crate as psibase;
    if action.service == virtual_server::SERVICE && action.method == method!("useDiskSys") {
        let args = psio::from_pssz::<virtual_server::action_structs::useDiskSys>(&action.rawData).ok()?;
        Some(args.amount_bytes)
    } else {
        None
    }
}

fn subtree_disk_net(atrace: &ActionTrace) -> i64 {
    let mut net = use_disk_sys_amount(&atrace.action).unwrap_or(0);
    for inner in &atrace.inner_traces {
        if let InnerTraceEnum::ActionTrace(c) = &inner.inner {
            net += subtree_disk_net(c);
        }
    }
    net
}

fn has_disk_activity(atrace: &ActionTrace) -> bool {
    if use_disk_sys_amount(&atrace.action).is_some() {
        return true;
    }
    for inner in &atrace.inner_traces {
        if let InnerTraceEnum::ActionTrace(c) = &inner.inner {
            if has_disk_activity(c) {
                return true;
            }
        }
    }
    false
}

fn collect_direct_disk<'a>(
    atrace: &'a ActionTrace,
    deltas: &mut Vec<i64>,
    shown_children: &mut Vec<&'a ActionTrace>,
) {
    use crate as psibase;
    for inner in &atrace.inner_traces {
        if let InnerTraceEnum::ActionTrace(c) = &inner.inner {
            let is_kv_notify =
                c.action.service == transact::SERVICE && c.action.method == method!("kvNotify");
            if let Some(amount) = use_disk_sys_amount(&c.action) {
                deltas.push(amount);
            } else if is_kv_notify {
                collect_direct_disk(c, deltas, shown_children);
            } else if has_disk_activity(c) {
                shown_children.push(c);
            }
        }
    }
}

fn format_signed_col(amount: Option<i64>, width: usize) -> String {
    match amount {
        None => " ".repeat(width),
        Some(n) => format!("{:>+width$}", n, width = width),
    }
}

const COL_WIDTH: usize = 8;
const COLS_TOTAL: usize = COL_WIDTH * 2 + 4;

fn format_disk_usage_action(
    schemas: &ActionDecoder,
    atrace: &ActionTrace,
    indent: usize,
    show_all_ops: bool,
    f: &mut fmt::Formatter<'_>,
) -> fmt::Result {
    let action_name = if atrace.action.method.value == 0 {
        "<entry>".to_string()
    } else {
        schemas.method_name(atrace.action.service, atrace.action.method)
    };

    let mut deltas = Vec::new();
    let mut shown_children = Vec::new();
    collect_direct_disk(atrace, &mut deltas, &mut shown_children);

    let direct_disk: i64 = deltas.iter().sum();
    let child_disk: i64 = shown_children.iter().copied().map(subtree_disk_net).sum();
    let self_col = if direct_disk == 0 {
        None
    } else {
        Some(direct_disk)
    };
    let children_col = if shown_children.is_empty() {
        None
    } else {
        Some(child_disk)
    };

    writeln!(
        f,
        "{}  {}  {:indent$}{}::{}",
        format_signed_col(self_col, COL_WIDTH),
        format_signed_col(children_col, COL_WIDTH),
        "",
        atrace.action.service,
        action_name,
    )?;

    if show_all_ops && !deltas.is_empty() {
        write!(f, "{:>COLS_TOTAL$}{:indent$}  ", "", "")?;
        for (i, d) in deltas.iter().enumerate() {
            if i != 0 {
                write!(f, " ")?;
            }
            write!(f, "{:+}", d)?;
        }
        writeln!(f)?;
    }

    for c in shown_children {
        format_disk_usage_action(schemas, c, indent + 2, show_all_ops, f)?;
    }

    Ok(())
}

fn format_transaction_disk_usage_trace(
    schemas: &ActionDecoder,
    ttrace: &TransactionTrace,
    show_all_ops: bool,
    f: &mut fmt::Formatter<'_>,
) -> fmt::Result {
    let total: i64 = ttrace.action_traces.iter().map(subtree_disk_net).sum();
    writeln!(f, "Total disk usage: {:+} bytes", total)?;
    writeln!(
        f,
        "{:>w1$}  {:>w2$}  action",
        "self",
        "children",
        w1 = COL_WIDTH,
        w2 = COL_WIDTH,
    )?;
    for a in &ttrace.action_traces {
        if has_disk_activity(a) {
            format_disk_usage_action(schemas, a, 0, show_all_ops, f)?;
        }
    }
    Ok(())
}

pub struct DisplayDiskUsageTrace<'a> {
    schemas: &'a RefCell<Arc<SchemaMap>>,
    trace: &'a TransactionTrace,
    show_all_ops: bool,
}

impl fmt::Display for DisplayDiskUsageTrace<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        format_transaction_disk_usage_trace(
            &ActionDecoder::new(self.schemas.borrow().clone()),
            self.trace,
            self.show_all_ops,
            f,
        )
    }
}

fn format_error_stack<T: std::fmt::Write>(
    schemas: &ActionDecoder,
    atrace: &ActionTrace,
    f: &mut T,
) -> fmt::Result {
    if atrace.error.is_some() {
        let action_name = schemas.method_name(atrace.action.service, atrace.action.method);
        writeln!(
            f,
            "{} => {}::{}",
            atrace.action.sender, atrace.action.service, action_name
        )?;
        for inner in &atrace.inner_traces {
            match &inner.inner {
                InnerTraceEnum::ConsoleTrace(_) => (),
                InnerTraceEnum::ActionTrace(a) => format_error_stack(schemas, a, f)?,
            }
        }
    }
    Ok(())
}

fn format_transaction_error_stack<T: std::fmt::Write>(
    schemas: &ActionDecoder,
    ttrace: &TransactionTrace,
    f: &mut T,
) -> fmt::Result {
    for a in &ttrace.action_traces {
        format_error_stack(schemas, a, f)?;
        break;
    }
    if let Some(message) = ttrace.error_text() {
        writeln!(f, "{}", message)?;
    }
    Ok(())
}

impl TransactionTrace {
    pub fn fmt_stack<'a, F: SchemaFetcher + 'a>(&self, afmt: &ActionFormatter<'a, F>) -> String {
        let mut result = String::new();
        format_transaction_error_stack(&afmt.decoder(), self, &mut result).unwrap();
        result
    }
}

#[async_trait(?Send)]
pub trait SchemaFetcher {
    async fn fetch_schema(&self, service: AccountNumber) -> Result<ServiceSchema, anyhow::Error>;
}

pub struct NullSchemaFetcher;

#[async_trait(?Send)]
impl SchemaFetcher for NullSchemaFetcher {
    async fn fetch_schema(&self, _service: AccountNumber) -> Result<ServiceSchema, anyhow::Error> {
        Err(anyhow::anyhow!("Schema fetching disabled"))
    }
}

pub struct DisplayTransactionTrace<'a> {
    schemas: &'a RefCell<Arc<SchemaMap>>,
    trace: &'a TransactionTrace,
}

impl fmt::Display for DisplayTransactionTrace<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        format_transaction_trace(
            &ActionDecoder::new(self.schemas.borrow().clone()),
            self.trace,
            0,
            f,
        )
    }
}

type PinType<'a> = LocalBoxFuture<'a, Result<(), Rc<Cell<anyhow::Error>>>>;

struct ActionFormatterImpl<'a, F: SchemaFetcher + 'a> {
    schemas: RefCell<Arc<SchemaMap>>,
    fetcher: F,
    pending: RefCell<HashMap<AccountNumber, Shared<PinType<'a>>>>,
}

pub struct ActionFormatter<'a, F: SchemaFetcher + 'a> {
    storage: Rc<ActionFormatterImpl<'a, F>>,
}

pub fn restore_lifetime<'a, 'b, T>(outer: &'a [T], inner: &'b [T]) -> Option<&'a [T]> {
    let inner_p = inner.as_ptr_range();
    let outer_p = outer.as_ptr_range();
    if inner_p.start as usize >= outer_p.start as usize
        && inner_p.end as usize <= outer_p.end as usize
    {
        let sz = size_of::<T>();
        let start = inner_p.start as usize - outer_p.start as usize;
        let end = inner_p.end as usize - outer_p.start as usize;
        if start % sz == 0 {
            Some(&outer[(start / sz)..(end / sz)])
        } else {
            None
        }
    } else {
        return None;
    }
}

impl<'a, F: SchemaFetcher + 'a> ActionFormatter<'a, F> {
    pub fn with_schemas(schemas: SchemaMap, fetcher: F) -> Self {
        ActionFormatter {
            storage: Rc::new(ActionFormatterImpl {
                schemas: RefCell::new(Arc::new(schemas)),
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
                        Arc::make_mut(&mut *storage.schemas.borrow_mut()).insert(service, Arc::new(schema));
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
    /// The schemas loaded so far, as a decoder of actions.
    pub fn decoder(&self) -> ActionDecoder {
        ActionDecoder::new(self.storage.schemas.borrow().clone())
    }
    /// Loads the schemas needed to present `act`: its service's, and those
    /// of the actions and service methods its arguments name, to any depth.
    pub async fn prepare_action(&self, act: &Action) {
        let mut actions = vec![act.clone()];
        let mut services = HashSet::new();
        while let Some(act) = actions.pop() {
            let _ = self.add_service(act.service).await;
            let found = {
                let schemas = self.storage.schemas.borrow();
                nested_calls(&schemas, act.service, act.method, &act.rawData)
            };
            actions.extend(found.actions);
            services.extend(found.methods.into_iter().map(|m| m.service));
        }
        for service in services {
            let _ = self.add_service(service).await;
        }
    }
    /// Converts an action to the JSON form of [PrettyAction](crate::PrettyAction), using
    /// the schemas loaded by [Self::prepare_action]. When the service's schema describes
    /// the method, `method` has its original spelling and `data`, which replaces
    /// `rawData`, holds the arguments, with any actions nested in them also decoded.
    pub fn action_to_json(&self, act: &Action) -> serde_json::Value {
        let decoder = self.decoder();
        let mut result = serde_json::Map::with_capacity(4);
        result.insert("sender".to_string(), act.sender.to_string().into());
        result.insert("service".to_string(), act.service.to_string().into());
        result.insert(
            "method".to_string(),
            decoder.method_name(act.service, act.method).into(),
        );
        if let Some(Ok(data)) = decoder.args(act) {
            result.insert("data".to_string(), data);
        } else {
            result.insert("rawData".to_string(), psio::to_hex(&act.rawData).into());
        }
        result.into()
    }
    pub async fn prepare_action_trace(&self, atrace: &ActionTrace) -> Result<(), anyhow::Error> {
        let mut res = self.add_service(atrace.action.service).await;
        if res.is_ok() {
            if !atrace.action.rawData.is_empty() {
                self.prepare_action(&atrace.action).await;
            }
        }
        for inner in &atrace.inner_traces {
            match &inner.inner {
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
    pub fn display_disk_usage_trace<'b>(
        &'b self,
        ttrace: &'b TransactionTrace,
        show_all_ops: bool,
    ) -> DisplayDiskUsageTrace<'b> {
        DisplayDiskUsageTrace {
            schemas: &self.storage.schemas,
            trace: ttrace,
            show_all_ops,
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

struct UnpackedAction<'a> {
    value: &'a Action,
    method: &'a str,
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
    schemas: &'a ActionDecoder,
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
        let action_name = self
            .schemas
            .method_name(atrace.action.service, atrace.action.method);

        let mut unpacked_args = None;
        let mut unpacked_retval = None;

        if !atrace.action.rawData.is_empty() {
            unpacked_args = self.schemas.args(&atrace.action).and_then(Result::ok);
        }
        if !atrace.raw_retval.is_empty() {
            unpacked_retval = self
                .schemas
                .retval(
                    atrace.action.service,
                    atrace.action.method,
                    &atrace.raw_retval,
                )
                .and_then(Result::ok);
        }

        let mut s = serializer.serialize_struct("ActionTrace", 5)?;

        s.serialize_field(
            "action",
            &UnpackedAction {
                value: &self.value.action,
                method: &action_name,
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
