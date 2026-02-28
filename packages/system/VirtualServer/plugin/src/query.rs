use graphql_client::GraphQLQuery;
use psibase_plugin::graphql::{query, scalars::*};
use psibase_plugin::types::Error;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "../service/schema.gql",
    query_path = "src/queries/user_resources.graphql"
)]
pub struct UserResources;

pub fn get_user_resources(user: &str) -> Result<(u64, u64, u64), Error> {
    println!("Getting user resources for user: {}", user);
    let u = query::<UserResources>(user_resources::Variables {
        user: user.to_string(),
    })?
    .user_resources;

    Ok((
        u.balance.quantity.value,
        u.buffer_capacity.quantity.value,
        u.auto_fill_threshold_percent as u64,
    ))
}

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "../service/schema.gql",
    query_path = "src/queries/billing_config.graphql"
)]
struct BillingConfig;

pub fn billing_enabled() -> Result<bool, Error> {
    let config = query::<BillingConfig>(billing_config::Variables)?.get_billing_config;

    Ok(config.map(|c| c.enabled).unwrap_or(false))
}
