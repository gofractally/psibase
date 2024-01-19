use binaryen::{CodegenConfig, Module};
use std::{
    env,
    fs::{create_dir_all, hard_link, read, remove_dir_all, write},
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

        let package_dir = out_dir.clone() + "/" + name + "-package";
        let _ = remove_dir_all(&package_dir);
        create_dir_all(package_dir.clone() + "/src").unwrap();
        hard_link(
            name.to_string() + "/Cargo.toml.in",
            package_dir.clone() + "/Cargo.toml",
        )
        .unwrap();
        hard_link(
            name.to_string() + "/src/lib.rs",
            package_dir.clone() + "/src/lib.rs",
        )
        .unwrap();

        let target_dir = out_dir.clone() + "/" + name + "-target";
        if !Command::new(&cargo)
            .args(["rustc"])
            .args(["--color", "always"])
            .args(["--target", "wasm32-wasi"])
            .args(["--target-dir", &target_dir])
            .args(["--manifest-path", &(package_dir + "/Cargo.toml")])
            .args(["--release"])
            .args(["--", "-C", "target-feature=+simd128,+bulk-memory,+sign-ext"])
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
