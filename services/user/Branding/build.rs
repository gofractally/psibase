use std::process::Command;

fn main() {
    // Tell Cargo that if the given file changes, to rerun this build script.
    // println!("cargo:rerun-if-changed=ui");
    // Use the `cc` crate to build a C file and statically link it.
    Command::new("yarn")
        .current_dir("./ui")
        .status()
        .expect("Failed to run `yarn`");
    Command::new("yarn")
        .current_dir("./ui")
        .args(&["build"])
        .status()
        .expect("Failed to run build project");
    println!("UI built!");
}
