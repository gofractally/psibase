use crate::bindings::host::common::server;
use crate::bindings::host::types::types::Error;
use crate::errors::ErrorType;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserResourcesResponse {
    data: UserResourcesData,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserResourcesData {
    user_resources: UserResources,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserResources {
    balance_raw: u64,
    buffer_capacity_raw: u64,
}

#[derive(Deserialize)]
struct Quantity {
    value: u64,
}

pub fn get_user_resources(user: &str) -> Result<(u64, u64), Error> {
    let query = format!(
        r#"query {{
            userResources(user: "{}") {{
                balanceRaw
                bufferCapacityRaw
            }}
        }}"#,
        user
    );

    let response_str = server::post_graphql_get_json(&query)?;
    let response: UserResourcesResponse =
        serde_json::from_str(&response_str).map_err(|e| -> Error {
            ErrorType::QueryError(format!("Failed to parse GraphQL response: {}", e)).into()
        })?;

    let balance = response.data.user_resources.balance_raw;
    let buffer_capacity = response.data.user_resources.buffer_capacity_raw;

    Ok((balance, buffer_capacity))
}
