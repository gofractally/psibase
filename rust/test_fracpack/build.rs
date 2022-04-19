use std::path::Path;

fn main() {
    cxx_build::bridge("src/bridge.rs")
        .file("tests/test.cpp")
        .file("../../external/simdjson/simdjson.cpp")
        .flag("-std=gnu++2a")
        .flag("-Wno-sign-compare") // TODO
        .flag("-Wno-ambiguous-reversed-operator") // TODO
        .include(Path::new("../../libraries/psio/include"))
        .include(Path::new("../../libraries/psio/consthash/include"))
        .include(Path::new("../../external/rapidjson/include"))
        .include(Path::new("../../external/simdjson/include"))
        .cpp_link_stdlib(Some("stdc++")) // TODO: doc says this should be auto detected
        .compile("test_fracpack");
}
