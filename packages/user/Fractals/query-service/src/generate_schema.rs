use async_graphql::{EmptyMutation, EmptySubscription, Schema};
use r_fractals::service::Query; // Adjust path if your service module is named differently

fn main() {
    // Build the schema from Query (and auto-discovered types like Fractal, Guild, etc.)
    let schema = Schema::build(Query, EmptyMutation, EmptySubscription).finish();

    // Print the SDL to stdout
    println!("{}", schema.sdl());

    // If you need to handle custom scalars explicitly (e.g., if not auto-registered),
    // add registrations like this before .finish():
    // .register_type::<YourCustomScalar>()
}
