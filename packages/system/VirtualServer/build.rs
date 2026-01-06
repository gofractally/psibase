use async_graphql::{EmptyMutation, EmptySubscription, Schema};
use std::env;
use std::fs;
use std::path::PathBuf;
use virtual_server::rpc::Query;

fn main() {
    println!("cargo:rerun-if-changed=service/src/rpc.rs");
    println!("cargo:rerun-if-changed=service/src/lib.rs");
    println!("cargo:rerun-if-changed=service/src/tables.rs");

    let schema = Schema::new(Query { user: None }, EmptyMutation, EmptySubscription);
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let schema_path = PathBuf::from(&manifest_dir).join("service").join("schema.gql");

    fs::write(&schema_path, schema.sdl()).expect("Failed to write schema.gql");

}
