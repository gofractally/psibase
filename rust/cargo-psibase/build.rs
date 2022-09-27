use binaryen::{CodegenConfig, Module};
use std::{
    env,
    fs::{read, write},
    process::{exit, Command},
};

fn main() {
    let cargo = env::var("CARGO").unwrap();
    let target = env::var("TARGET").unwrap();
    let out_dir = env::var("OUT_DIR").unwrap();

    if target.starts_with("wasm") {
        return;
    }

    let build = |name| {
        println!("cargo:rerun-if-changed={}", name);

        let target_dir = out_dir.clone() + "/" + name + "-target";
        if !Command::new(&cargo)
            .args(["build"])
            .args(["--color", "always"])
            .args(["--target", "wasm32-wasi"])
            .args(["--target-dir", &target_dir])
            .args(["--manifest-path", &(name.to_owned() + "/Cargo.toml")])
            .args(["--release"])
            .status()
            .unwrap()
            .success()
        {
            exit(1);
        }

        let code = read(target_dir + "/wasm32-wasi/release/" + name + ".wasm").unwrap();
        let mut module = Module::read(&code).unwrap();
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
