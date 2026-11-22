use std::path::Path;

fn main() {
    let mut build = cxx_build::bridge("src/bridge.rs");
    build
        .file("tests/test.cpp")
        .file("../../libraries/psio1/src/chrono.cpp")
        .file("../../libraries/psio1/src/from_json.cpp")
        .file("../../libraries/psio1/src/schema.cpp")
        .file("../../libraries/psio1/src/fpconv.c")
        .flag("-std=gnu++23")
        .extra_warnings(false)
        .flag("-Wno-sign-compare") // TODO
        .flag("-Wno-missing-field-initializers") // TODO
        .flag("-Wno-unused-local-typedef") // TODO
        .flag("-Wno-ambiguous-reversed-operator") // TODO
        .include(Path::new("../../libraries/psio1/include"))
        .include(Path::new("../../libraries/psio1/consthash/include"))
        .include(Path::new("../../external/rapidjson/include"))
        // TEMPORARY: removed with psio1. psio1 recognises types declared with
        // PSIO, so its headers include PSIO's (acquired by the CMake configure).
        .include(Path::new("../../external/psio/cpp/include"))
        .include(Path::new("../../external/psio/cpp/external/xxhash"))
        .define("PSIO_HAVE_SIMDJSON", "0");
    // Boost is not on the default include path everywhere (Homebrew on macOS).
    // CMake passes the directory it found; a plain `cargo test` may set it too.
    println!("cargo:rerun-if-env-changed=PSIBASE_BOOST_INCLUDE_DIR");
    if let Ok(boost) = std::env::var("PSIBASE_BOOST_INCLUDE_DIR") {
        if !boost.is_empty() {
            build.include(Path::new(&boost));
        }
    }
    // Apple toolchains link libc++; let the cc crate pick it there.
    if !cfg!(target_vendor = "apple") {
        build.cpp_link_stdlib(Some("stdc++")); // TODO: doc says this should be auto detected
    }
    build.compile("test_fracpack");
    println!("cargo:rerun-if-changed=tests/test.cpp");
}
