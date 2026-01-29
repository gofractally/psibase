use crate::bindings::host::common::server;
use crate::bindings::host::types::types::Error;
use crate::errors::ErrorType;
use psibase::services::tokens::Decimal;
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
    balance: Decimal,
    buffer_capacity: Decimal,
    auto_fill_threshold_percent: u64,
}

pub fn get_user_resources(user: &str) -> Result<(u64, u64, u64), Error> {
    let query = format!(
        r#"query {{
            userResources(user: "{}") {{
                balance
                bufferCapacity
                autoFillThresholdPercent
            }}
        }}"#,
        user
    );

    let response_str = server::post_graphql_get_json(&query)?;
    let response: UserResourcesResponse =
        serde_json::from_str(&response_str).map_err(|e| -> Error {
            ErrorType::QueryError(format!("Failed to parse GraphQL response: {}", e)).into()
        })?;

    let balance = response.data.user_resources.balance.quantity.value;
    let buffer_capacity = response.data.user_resources.buffer_capacity.quantity.value;
    let auto_fill_threshold = response.data.user_resources.auto_fill_threshold_percent;

    Ok((balance, buffer_capacity, auto_fill_threshold))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BillingConfigResponse {
    data: BillingConfigData,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BillingConfigData {
    get_billing_config: Option<InternalBillingConfig>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InternalBillingConfig {
    enabled: bool,
}

#[derive(Default)]
pub struct BillingConfig {
    pub enabled: bool,
}

impl From<InternalBillingConfig> for BillingConfig {
    fn from(config: InternalBillingConfig) -> Self {
        Self {
            enabled: config.enabled,
        }
    }
}

pub fn billing_config() -> Result<BillingConfig, Error> {
    let query = r#"query {
        getBillingConfig {
            enabled
        }
    }"#;

    let response_str = server::post_graphql_get_json(query)?;
    let response: BillingConfigResponse =
        serde_json::from_str(&response_str).map_err(|e| -> Error {
            ErrorType::QueryError(format!("Failed to parse GraphQL response: {}", e)).into()
        })?;

    Ok(response
        .data
        .get_billing_config
        .unwrap_or(InternalBillingConfig { enabled: false })
        .into())
}
