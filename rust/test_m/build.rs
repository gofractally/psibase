use std::path::Path;

fn main() {
    cxx_build::bridge("src/main.rs")
        .file("src/foo.cpp")
        .flag("-std=gnu++2a")
        .include(Path::new("../../libraries/psio/include"))
        .compile("test_m");
}
