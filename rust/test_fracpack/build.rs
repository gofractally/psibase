use std::path::Path;

fn main() {
    cxx_build::bridge("src/bridge.rs")
        .file("tests/test.cpp")
        .file("../../libraries/psio/src/schema.cpp")
        .file("../../libraries/psio/src/fpconv.c")
        .flag("-std=gnu++2a")
        .extra_warnings(false)
        .flag("-Wno-sign-compare") // TODO
        .flag("-Wno-missing-field-initializers") // TODO
        .flag("-Wno-unused-local-typedef") // TODO
        .flag("-Wno-ambiguous-reversed-operator") // TODO
        .include(Path::new("../../libraries/psio/include"))
        .include(Path::new("../../libraries/psio/consthash/include"))
        .include(Path::new("../../external/rapidjson/include"))
        .cpp_link_stdlib(Some("stdc++")) // TODO: doc says this should be auto detected
        .compile("test_fracpack");
    println!("cargo:rerun-if-changed=tests/test.cpp");
}
