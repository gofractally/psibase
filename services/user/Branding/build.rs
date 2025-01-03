use std::fs;
use std::io::Path;
use std::io::Write;

use std::process::Command;

fn main() {
    if !Path::new("./ui").exists() {
        // no UI to build
        return;
    }
    // Touch a marker file to ensure that cargo reruns this build script no matter what
    // unless it may decide in appropriately that it doesn't need to run the script.
    fs::File::create("./ui_build")
        .unwrap()
        .write_all(b"")
        .unwrap();

    Command::new("yarn")
        .current_dir("./ui")
        .status()
        .expect("Failed to run `yarn`");
    Command::new("yarn")
        .args(&["build"])
        .current_dir("./ui")
        .status()
        .expect("Failed to run build project");
}
