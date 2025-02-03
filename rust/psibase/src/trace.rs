use std::fmt;

use crate::{Action, Hex, Pack, Unpack};
use serde::{Deserialize, Serialize};
use serde_aux::prelude::deserialize_number_from_string;

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
        format_action_trace(self, 0, f)
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
    pub fn console(&self) -> TraceConsole {
        return TraceConsole { trace: self };
    }
}

impl fmt::Display for TransactionTrace {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        format_transaction_trace(self, 0, f)
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

fn format_action_trace(
    atrace: &ActionTrace,
    indent: usize,
    f: &mut fmt::Formatter<'_>,
) -> fmt::Result {
    writeln!(f, "{:indent$}action:", "")?;
    writeln!(
        f,
        "{:indent$}    {} => {}::{}",
        "", atrace.action.sender, atrace.action.service, atrace.action.method
    )?;
    writeln!(
        f,
        "{:indent$}    raw_retval: {} bytes",
        "",
        atrace.raw_retval.len()
    )?;
    for inner in &atrace.inner_traces {
        match &inner.inner {
            InnerTraceEnum::ConsoleTrace(c) => format_console(c, indent + 4, f)?,
            InnerTraceEnum::EventTrace(e) => format_event(e, indent + 4, f)?,
            InnerTraceEnum::ActionTrace(a) => format_action_trace(a, indent + 4, f)?,
        }
    }
    Ok(())
}

fn format_transaction_trace(
    ttrace: &TransactionTrace,
    indent: usize,
    f: &mut fmt::Formatter<'_>,
) -> fmt::Result {
    for a in &ttrace.action_traces {
        format_action_trace(a, indent, f)?;
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
