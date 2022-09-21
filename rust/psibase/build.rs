use binaryen::{CodegenConfig, Module};
use std::{
    env,
    fs::{read, write},
    process::Command,
};

fn main() {
    let cargo = env::var("CARGO").unwrap();
    let target = env::var("TARGET").unwrap();
    let out_dir = env::var("OUT_DIR").unwrap();

    if target.starts_with("wasm") {
        return;
    }

    let build = |name| {
        let target_dir = out_dir.clone() + "/" + name + "-target";
        Command::new(&cargo)
            .arg("build")
            .arg("--target")
            .arg("wasm32-wasi")
            .arg("--target-dir")
            .arg(&target_dir)
            .arg("--manifest-path")
            .arg(name.to_owned() + "/Cargo.toml")
            .arg("--release")
            .status()
            .unwrap();

        let mut module = Module::read(
            &read(target_dir.clone() + "/wasm32-wasi/release/" + name + ".wasm").unwrap(),
        )
        .unwrap();
        module.optimize(&CodegenConfig {
            shrink_level: 1,
            optimization_level: 2,
            debug_info: false,
        });
        write(out_dir.clone() + "/" + name + ".wasm", module.write()).unwrap();
    };

    build("service_wasi_polyfill");
    build("tester_wasi_polyfill");
}
