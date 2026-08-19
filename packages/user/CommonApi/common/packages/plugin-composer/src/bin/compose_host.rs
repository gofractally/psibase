//! Build-time Host composite.
//!
//! Composes the host plugin blob (with tracers) into one component so the
//! browser fetches a single HTTP-cached `host/composite.wasm` instead of
//! composing host plugins in the client every page session.
//!
//! Usage:
//!   compose-host --out <path> <service>:<plugin>=<wasm-path>...

use anyhow::{bail, Context, Result};
use plugin_composer::{compose_host, PluginId, WasmPlugin};

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let mut out: Option<String> = None;
    let mut plugins: Vec<WasmPlugin> = Vec::new();

    while let Some(arg) = args.next() {
        if arg == "--out" {
            out = Some(args.next().context("--out requires a path")?);
            continue;
        }
        let (id, path) = arg
            .split_once('=')
            .with_context(|| format!("expected <service>:<plugin>=<path>, got `{arg}`"))?;
        let (service, plugin) = id
            .split_once(':')
            .with_context(|| format!("expected <service>:<plugin>, got `{id}`"))?;
        let wasm = std::fs::read(path).with_context(|| format!("read {path}"))?;
        plugins.push(WasmPlugin {
            id: PluginId::new(service, plugin),
            wasm,
        });
    }

    let out = out.context("--out is required")?;
    if plugins.is_empty() {
        bail!("no plugins given");
    }

    let result = compose_host(&plugins, true)?;
    std::fs::write(&out, &result.wasm).with_context(|| format!("write {out}"))?;
    eprintln!(
        "host composite: [{}] {} bytes -> {out}",
        result
            .compose_set
            .iter()
            .map(|id| id.key())
            .collect::<Vec<_>>()
            .join(", "),
        result.wasm.len(),
    );
    Ok(())
}
