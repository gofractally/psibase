// Build the GraphQL schema from the `Query` type in the r-fractals crate
use async_graphql::{EmptyMutation, EmptySubscription, Schema};
use r_fractals::service::Query;
use std::fs;

fn main() {
    // Build the schema
    let schema = Schema::build(Query, EmptyMutation, EmptySubscription).finish();

    // Path where the schema should be written
    let out_path = "../query-service/schema.graphql";

    // Write the SDL to the target file
    fs::write(out_path, schema.sdl()).expect("Unable to write schema to file");

    println!("✅ Schema generated successfully at {}", out_path);
}
