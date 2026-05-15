use std::str::FromStr;

use psibase::{services::tokens::Decimal, AccountNumber};
use serde::{de::DeserializeOwned, Deserialize};

use crate::tables::tables::{NetworkVariables, ServerSpecs};
use crate::Wrapper;

/// Runs a GraphQL query against `service` and deserializes `data[field]` into `T`.
fn query<T: DeserializeOwned>(
    chain: &psibase::Chain,
    service: AccountNumber,
    field: &str,
    query: &str,
) -> Result<T, psibase::Error> {
    let mut v: serde_json::Value = chain.graphql(service, query)?;
    Ok(serde_json::from_value(v["data"][field].take())?)
}

/// Same as `query`, but with a bearer auth token.
fn query_auth<T: DeserializeOwned>(
    chain: &psibase::Chain,
    service: AccountNumber,
    field: &str,
    query: &str,
    auth_token: &str,
) -> Result<T, psibase::Error> {
    let mut v: serde_json::Value = chain.graphql_auth(service, query, auth_token)?;
    Ok(serde_json::from_value(v["data"][field].take())?)
}

#[allow(non_snake_case)]
#[derive(Deserialize)]
pub(super) struct BillingConfig {
    pub feeReceiver: String,
}

#[allow(non_snake_case)]
#[derive(Deserialize)]
pub(super) struct UserResources {
    pub balance: Decimal,
    pub bufferCapacity: Decimal,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DiskPricingState {
    pub remaining_capacity: u64,
    pub max_capacity: u64,
    pub max_reserve: Decimal,
    pub curve_d: u64,
    pub virtual_balance: VirtualBalanceState,
}

#[derive(Deserialize)]
pub(super) struct VirtualBalanceState {
    pub shortfall: Decimal,
    pub excess: Decimal,
}

pub(super) fn get_billing_config(chain: &psibase::Chain) -> Result<BillingConfig, psibase::Error> {
    query(
        chain,
        Wrapper::SERVICE,
        "getBillingConfig",
        r#"query { getBillingConfig { feeReceiver } }"#,
    )
}

pub(super) fn get_user_resources(
    chain: &psibase::Chain,
    account: AccountNumber,
    auth_token: &str,
) -> Result<UserResources, psibase::Error> {
    query_auth(
        chain,
        Wrapper::SERVICE,
        "userResources",
        &format!(r#"query {{ userResources(account: "{account}") {{ balance bufferCapacity }} }}"#),
        auth_token,
    )
}

pub(super) fn get_server_specs(chain: &psibase::Chain) -> ServerSpecs {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Wire {
        net_bps: u64,
        storage_bytes: u64,
    }
    let w: Wire = query(
        chain,
        Wrapper::SERVICE,
        "getServerSpecs",
        r#"query { getServerSpecs { netBps storageBytes } }"#,
    )
    .unwrap();
    ServerSpecs {
        net_bps: w.net_bps,
        storage_bytes: w.storage_bytes,
    }
}

pub(super) fn get_network_vars(chain: &psibase::Chain) -> NetworkVariables {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Wire {
        block_replay_factor: u8,
        per_block_sys_cpu_ns: u64,
        obj_storage_bytes: u64,
        subj_storage_bytes: u64,
    }
    let w: Wire = query(
        chain,
        Wrapper::SERVICE,
        "getNetworkVariables",
        r#"query { getNetworkVariables { blockReplayFactor perBlockSysCpuNs objStorageBytes subjStorageBytes } }"#,
    )
    .unwrap();
    NetworkVariables {
        block_replay_factor: w.block_replay_factor,
        per_block_sys_cpu_ns: w.per_block_sys_cpu_ns,
        obj_storage_bytes: w.obj_storage_bytes,
        subj_storage_bytes: w.subj_storage_bytes,
    }
}

const DISK_PRICING_QUERY: &str = r#"query {
    diskPricing {
        reserve
        remainingCapacity
        maxCapacity
        maxReserve
        curveD
        feePpm
        spotPrice
        utilizationPct
        virtualBalance { shortfall excess }
    }
}"#;

pub(super) fn get_disk_state(chain: &psibase::Chain) -> DiskPricingState {
    query(chain, Wrapper::SERVICE, "diskPricing", DISK_PRICING_QUERY).unwrap()
}

pub(super) fn get_total_consumed_disk(
    chain: &psibase::Chain,
    account: AccountNumber,
    auth_token: &str,
) -> i64 {
    let result: serde_json::Value = chain
        .graphql_auth(
            Wrapper::SERVICE,
            &format!(
                r#"query {{
                    consumedHistory(account: "{account}", last: 1000) {{
                        edges {{ node {{ resource amount }} }}
                    }}
                }}"#
            ),
            auth_token,
        )
        .unwrap();

    result["data"]["consumedHistory"]["edges"]
        .as_array()
        .map(|edges| {
            edges
                .iter()
                .filter_map(|edge| {
                    let node = &edge["node"];
                    if node["resource"].as_str() == Some("Disk") {
                        node["amount"].as_i64()
                    } else {
                        None
                    }
                })
                .sum()
        })
        .unwrap_or(0)
}

pub(super) fn get_enable_billing_cost(chain: &psibase::Chain) -> Result<u64, psibase::Error> {
    let s: String = query(
        chain,
        Wrapper::SERVICE,
        "enableBillingCost",
        r#"query { enableBillingCost }"#,
    )?;
    let decimal = Decimal::from_str(&s).map_err(psibase::Error::new)?;
    Ok(decimal.quantity.value)
}

pub(super) fn get_invite_cost(
    chain: &psibase::Chain,
    num_accounts: u16,
    auth_token: &str,
) -> Result<String, psibase::Error> {
    query_auth(
        chain,
        psibase::services::invite::SERVICE,
        "getInviteCost",
        &format!(r#"query {{ getInviteCost(numAccounts: {num_accounts}) }}"#),
        auth_token,
    )
}
