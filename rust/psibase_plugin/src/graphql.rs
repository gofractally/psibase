use crate::host::server;
use crate::types::Error;
use graphql_client::GraphQLQuery;
use serde::Serialize;
use serde_json::Value;

/// Standard scalar type aliases for psibase GraphQL schemas.
///
/// Consumer plugins must bring whatever scalars they use in their queries into scope before
/// any `#[derive(GraphQLQuery)]` so that the proc macro finds the corresponding Rust types.
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

// Given a `graphql_client`-generated query type and its variables, produce a flat GraphQL query
// string with all `$variable` references replaced by inlined values (We don't support the separate
// variables query syntax yet).
fn build_query_string<Q: GraphQLQuery>(variables: Q::Variables) -> String {
    let body = Q::build_query(variables);
    inline_variables(body.query, &body.variables)
}

// Deserialize a GraphQL JSON response string (as returned by `post_graphql_get_json`) into typed
// `ResponseData`.
//
// `post_graphql_get_json` already checks for GraphQL errors, so the JSON is expected to have the
//  shape `{"data": { ... }}`. This function unwraps the outer `data` envelope.
fn parse_response<T: serde::de::DeserializeOwned>(json: &str) -> T {
    #[derive(serde::Deserialize)]
    struct Envelope<D> {
        data: D,
    }
    let envelope: Envelope<T> =
        serde_json::from_str(json).expect("GraphQL response missing or invalid \"data\" envelope");
    envelope.data
}

// Takes a GraphQL query with `$variable` references and variable definitions, plus a serializable
// variables value, and returns a query with variables inlined.
//
// e.g. `query Foo($x: Int!) { bar(x: $x) }`
// =>   `query Foo { bar(x: 42) }`
fn inline_variables<V: Serialize>(query: &str, variables: &V) -> String {
    let vars_json = serde_json::to_value(variables).expect("Failed to serialize GraphQL variables");

    let mut result = query.to_string();

    // Strip variable definitions: remove the (...) block before the first {
    if let Some(open_brace) = result.find('{') {
        let prefix = &result[..open_brace];
        if let Some(open_paren) = prefix.find('(') {
            let mut depth: u32 = 0;
            let mut close_paren = open_paren;
            for (i, ch) in result[open_paren..].char_indices() {
                match ch {
                    '(' => depth += 1,
                    ')' => {
                        depth -= 1;
                        if depth == 0 {
                            close_paren = open_paren + i;
                            break;
                        }
                    }
                    _ => {}
                }
            }
            result = format!(
                "{}{}",
                result[..open_paren].trim_end(),
                &result[close_paren + 1..]
            );
        }
    }

    // Replace $varName with inlined literal values.
    // Sort by name length descending so that $userName is replaced before $user (avoids partial
    // prefix matches).
    if let Value::Object(map) = vars_json {
        let mut vars: Vec<_> = map.into_iter().collect();
        vars.sort_by(|a, b| b.0.len().cmp(&a.0.len()));

        for (name, value) in vars {
            let pattern = format!("${}", name);
            let replacement = json_to_graphql_literal(&value);
            result = result.replace(&pattern, &replacement);
        }
    }

    result
}

// Convert a `serde_json::Value` to a GraphQL value literal string.
//
// For scalars, JSON and GraphQL literal syntax are identical:
//   `"hello"`, `42`, `true`, `null`
//
// For objects, GraphQL uses unquoted keys: `{key: "val"}` not `{"key": "val"}`.
fn json_to_graphql_literal(value: &Value) -> String {
    match value {
        Value::String(s) => {
            format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
        }
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".to_string(),
        Value::Array(arr) => {
            let items: Vec<String> = arr.iter().map(json_to_graphql_literal).collect();
            format!("[{}]", items.join(", "))
        }
        Value::Object(obj) => {
            let fields: Vec<String> = obj
                .iter()
                .map(|(k, v)| format!("{}: {}", k, json_to_graphql_literal(v)))
                .collect();
            format!("{{{}}}", fields.join(", "))
        }
    }
}
