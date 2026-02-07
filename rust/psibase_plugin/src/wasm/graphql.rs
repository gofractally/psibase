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

/// Builds the query string with inlined variables, posts it via `post_graphql_get_json`, and
/// deserializes the response into typed `ResponseData`.
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
