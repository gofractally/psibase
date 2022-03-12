use std::path::Path;

fn main() {
    cxx_build::bridge("tests/test.rs")
        .file("tests/test.cpp")
        .flag("-std=gnu++2a")
        .include(Path::new("../../libraries/psio/include"))
        .include(Path::new("../../external/rapidjson/include"))
        .compile("test_m");
}
