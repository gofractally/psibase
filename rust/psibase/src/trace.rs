use std::fmt;

use crate::{Action, Fracpack, Reflect, Hex};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Fracpack, Reflect, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[serde(rename_all = "camelCase")]
pub struct ActionTrace {
    pub action: Action,
    pub raw_retval: Hex<Vec<u8>>,
    pub inner_traces: Vec<InnerTrace>,
    pub error: Option<String>,
}

impl fmt::Display for ActionTrace {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        format_action_trace(self, 0, f)
    }
}

#[derive(Debug, Clone, Fracpack, Reflect, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[serde(rename_all = "camelCase")]
pub struct EventTrace {
    pub name: String,
    pub data: Hex<Vec<u8>>,
}

#[derive(Debug, Clone, Fracpack, Reflect, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[serde(rename_all = "camelCase")]
pub struct ConsoleTrace {
    pub console: String,
}

#[derive(Debug, Clone, Fracpack, Reflect, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
pub enum InnerTraceEnum {
    ConsoleTrace(ConsoleTrace),
    EventTrace(EventTrace),
    ActionTrace(ActionTrace),
}

#[derive(Debug, Clone, Fracpack, Reflect, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[serde(rename_all = "camelCase")]
pub struct InnerTrace {
    pub inner: InnerTraceEnum,
}

#[derive(Debug, Clone, Fracpack, Reflect, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
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
}

impl fmt::Display for TransactionTrace {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        format_transaction_trace(self, 0, f)
    }
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
