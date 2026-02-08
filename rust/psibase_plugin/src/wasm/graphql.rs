//! # psibase_plugin::graphql
//!
//! A library that works with the `graphql_client` crate to simplify making GraphQL queries to the
//! server of the caller plugin.
//!
//! ## Usage
//!
//! ### Step 1
//! Add the `graphql_client` crate as a dependency to your plugin crate
//!
//! ### Step 2
//! Save your server's graphql schema as a `.gql` file in your plugin crate
//!
//! ### Step 3
//! Create a `.graphql` file in your plugin crate with the query you want to make
//!   ```#.graphql
//!   query UserResources($user: AccountNumber!) {
//!       userResources(user: $user) {
//!           balance
//!           bufferCapacity
//!           autoFillThresholdPercent
//!       }
//!   }
//!   ```
//! ### Step 4
//! In rust:
//!
//! - **Add the necessary imports**
//!   ```
//!   use graphql_client::GraphQLQuery;
//!   use psibase_plugin::graphql::{query};
//!   ```
//!   [Optional] Add the `scalars` module to your plugin crate if your schema includes custom scalars (e.g. `Decimal`,
//!   `AccountNumber`, `Memo`, etc.)
//!   ```
//!   use psibase_plugin::graphql::scalars::*;
//!   ```
//!
//! - **Create a graphql query struct for your query**
//!   ```
//!   #[derive(GraphQLQuery)]
//!   #[graphql(
//!       schema_path = "../service/schema.gql",
//!       query_path = "src/queries/user_resources.graphql"
//!   )]
//!   pub struct UserResources;
//!   ```
//!
//! - **Call the `query` function, pass needed variables, and get the typed response**
//!   ```
//!   let response = query::<UserResources>(user_resources::Variables { user })?;
//!   println!("Balance: {:?}", response.user_resources.balance);
//!   ```
//!
use crate::graphql_utils;
use crate::host::server;
use crate::types::Error;
use graphql_client::GraphQLQuery;

pub mod scalars {
    pub type AccountNumber = String;
    pub type Decimal = psibase::services::tokens::Decimal;
    pub type Memo = String;
}

fn query_impl<Q: GraphQLQuery>(
    variables: Q::Variables,
    debug_print: bool,
) -> Result<Q::ResponseData, Error> {
    let query = build_query_string::<Q>(variables);
    if debug_print {
        println!("Query: {}", query);
    }
    let json = server::post_graphql_get_json(&query)?;
    if debug_print {
        println!("Response: {}", json);
    }
    Ok(parse_response(&json))
}

/// Makes the specified query to the app server and deserializes the response into types `ResponseData`.
pub fn query<Q: GraphQLQuery>(variables: Q::Variables) -> Result<Q::ResponseData, Error> {
    query_impl::<Q>(variables, false)
}

/// Same as `query`, but adds debug prints the query and response to stdout
pub fn query_debug<Q: GraphQLQuery>(variables: Q::Variables) -> Result<Q::ResponseData, Error> {
    query_impl::<Q>(variables, true)
}

fn build_query_string<Q: GraphQLQuery>(variables: Q::Variables) -> String {
    let body = Q::build_query(variables);
    graphql_utils::inline_variables(body.query, &body.variables)
}

fn parse_response<T: serde::de::DeserializeOwned>(json: &str) -> T {
    #[derive(serde::Deserialize)]
    struct Envelope<D> {
        data: D,
    }
    let envelope: Envelope<T> =
        serde_json::from_str(json).expect("GraphQL response missing or invalid \"data\" envelope");
    envelope.data
}
