mod link;

use anyhow::{anyhow, Context};
use binaryen::{CodegenConfig, Module};
use cargo::core::compiler::{CompileKind, CompileTarget};
use cargo::core::Workspace;
use cargo::ops::{compile, CompileOptions};
use cargo::util::{command_prelude::CompileMode, interning::InternedString};
use cargo::Config;
use std::fs::{canonicalize, read, write};
use std::path::Path;

const SERVICE_POLYFILL: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/service_wasi_polyfill.wasm"));
const TESTER_POLYFILL: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/tester_wasi_polyfill.wasm"));

fn optimize(filename: &Path, code: &[u8]) -> Result<Vec<u8>, anyhow::Error> {
    // println!("optimizing {}", filename.to_string_lossy());
    let mut module = Module::read(code)
        .map_err(|_| anyhow!("Binaryen failed to parse {}", filename.to_string_lossy()))?;
    // println!("before optimize: {}", module.write().len());
    module.optimize(&CodegenConfig {
        shrink_level: 1,
        optimization_level: 2,
        debug_info: false,
    });
    // println!("after optimize: {}", module.write().len());
    Ok(module.write())
}

fn process(filename: &Path, polyfill: &[u8]) -> Result<(), anyhow::Error> {
    println!("{}", filename.to_string_lossy());
    let code = &read(filename)
        .with_context(|| format!("Failed to read {}", filename.to_string_lossy()))?;
    let code = link::link(filename, code, polyfill)?;
    let code = optimize(filename, &code)?;
    write(filename, code).with_context(|| format!("Failed to write {}", filename.to_string_lossy()))
}

fn main() -> Result<(), anyhow::Error> {
    let config = Config::default()?;
    let workspace = Workspace::new(&canonicalize(Path::new("Cargo.toml"))?, &config)?;
    let mut options = CompileOptions::new(&config, CompileMode::Build)?;
    options.build_config.requested_kinds =
        vec![CompileKind::Target(CompileTarget::new("wasm32-wasi")?)];
    // options.build_config.mode = CompileMode::Test;
    options.build_config.requested_profile = InternedString::new("release");
    let compilation = compile(&workspace, &options)?;
    println!();
    for output in compilation.tests.iter() {
        process(&output.path, TESTER_POLYFILL)?
    }
    for output in compilation.binaries.iter() {
        process(&output.path, TESTER_POLYFILL)?
    }
    for output in compilation.cdylibs.iter() {
        process(&output.path, SERVICE_POLYFILL)?
    }
    Ok(())
}
