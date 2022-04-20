use std::path::Path;

fn main() {
    cxx_build::bridge("src/bridge.rs")
        .file("src/missing.cpp")
        .file("../../external/simdjson/simdjson.cpp")
        .file("../../libraries/psibase/common/src/time.cpp")
        .flag("-std=gnu++2a")
        .flag("-Wno-ambiguous-reversed-operator") // TODO
        .flag("-Wno-ignored-qualifiers") // TODO
        .flag("-Wno-sign-compare") // TODO
        .flag("-Wno-unused-parameter") // TODO
        .include(Path::new("../../external/rapidjson/include"))
        .include(Path::new("../../external/simdjson/include"))
        .include(Path::new("../../libraries/abieos/include"))
        .include(Path::new("../../libraries/psibase/common/include"))
        .include(Path::new("../../libraries/psio/consthash/include"))
        .include(Path::new("../../libraries/psio/include"))
        .cpp_link_stdlib(Some("stdc++")) // TODO: doc says this should be auto detected
        .compile("psibase");
}
