use crate::tables::tables::{
    BillingConfig, BillingConfigTable, CpuPricing, NetPricing, NetworkSpecs, NetworkSpecsTable,
    NetworkVariables, ServerSpecs as InternalServerSpecs, ServerSpecsTable, UserSettings,
};
use async_graphql::{connection::Connection, *};
use psibase::{
    services::tokens::{Decimal, Precision, Quantity, Wrapper as Tokens},
    AccountNumber, EventQuery, Table,
};
use serde::Deserialize;
use serde_aux::field_attributes::deserialize_number_from_string;

pub mod resources {
    pub const CPU: u8 = 0;
    pub const NET: u8 = 1;
    pub const _STORAGE: u8 = 2;
}

#[derive(Deserialize, SimpleObject)]
#[graphql(complex)]
pub struct ConsumptionEvent {
    account: AccountNumber,
    #[graphql(skip)]
    #[serde(deserialize_with = "deserialize_number_from_string")]
    resource: u8,
    #[graphql(skip)]
    #[serde(deserialize_with = "deserialize_number_from_string")]
    amount: u64,
    #[graphql(skip)]
    #[serde(deserialize_with = "deserialize_number_from_string")]
    cost: u64,
}

impl ConsumptionEvent {
    fn get_unit(&self) -> &'static str {
        match self.resource {
            resources::CPU => "ns",
            resources::NET => "bytes",
            _ => "Unknown",
        }
    }
}

#[ComplexObject]
impl ConsumptionEvent {
    pub async fn resource(&self) -> &'static str {
        match self.resource {
            resources::CPU => "CPU",
            resources::NET => "Net",
            _ => "Unknown",
        }
    }

    pub async fn amount(&self) -> String {
        format!("{} {}", self.amount, self.get_unit())
    }

    pub async fn cost(&self) -> Decimal {
        let token = BillingConfig::get_sys_token();
        Decimal::new(Quantity::from(self.cost), token.precision)
    }
}

#[derive(Deserialize, SimpleObject)]
#[graphql(complex)]
pub struct SubsidyEvent {
    purchaser: AccountNumber,
    recipient: AccountNumber,
    #[serde(deserialize_with = "deserialize_number_from_string")]
    #[graphql(skip)]
    amount: u64,
    memo: psibase::Memo,
}

#[ComplexObject]
impl SubsidyEvent {
    pub async fn amount(&self) -> Decimal {
        let token = BillingConfig::get_sys_token();
        Decimal::new(Quantity::from(self.amount), token.precision)
    }
}

#[derive(Deserialize, SimpleObject)]
#[graphql(complex)]
pub struct BlockUsageEvent {
    /// The block number
    #[serde(deserialize_with = "deserialize_number_from_string")]
    block_num: psibase::BlockNum,
    // The amount of network usage in the block in ppm (parts per million) of total capacity
    #[graphql(skip)]
    #[serde(deserialize_with = "deserialize_number_from_string")]
    net_usage_ppm: u32,
    // The amount of CPU usage in the block in ppm (parts per million) of total capacity
    #[graphql(skip)]
    #[serde(deserialize_with = "deserialize_number_from_string")]
    cpu_usage_ppm: u32,
}

#[ComplexObject]
impl BlockUsageEvent {
    /// The amount of network usage in the block as a percentage of total capacity
    pub async fn net_usage_pct(&self) -> Decimal {
        Decimal::new(
            Quantity::from(self.net_usage_ppm as u64),
            Precision::new(4).unwrap(),
        )
    }

    /// The amount of CPU usage in the block as a percentage of total capacity
    pub async fn cpu_usage_pct(&self) -> Decimal {
        Decimal::new(
            Quantity::from(self.cpu_usage_ppm as u64),
            Precision::new(4).unwrap(),
        )
    }
}

#[derive(SimpleObject)]
pub struct ServerSpecs {
    /// Amount of bandwidth capacity per second per server
    pub net_bps: u64,
    /// Amount of storage space in bytes per server
    pub storage_bytes: u64,
    /// Suggested minimum amount of memory in bytes per server
    pub recommended_min_memory_bytes: u64,
}

#[derive(SimpleObject)]
pub struct UserResources {
    /// Balance of resources owned by the user formatted as a decimal string using
    /// resource token precision
    balance: Decimal,

    /// The capacity of the user's resource buffer formatted as a decimal string using
    /// resource token precision
    buffer_capacity: Decimal,

    /// Unformatted (integer) balance of resources owned by the user
    balance_raw: u64,

    /// Unformatted (integer)capacity of the user's resource buffer
    buffer_capacity_raw: u64,

    /// Whether the user is configured for auto-filling of the resource buffer
    auto_fill: bool,
}

//  Derived from expected 80% of reads/writes in 20% of the total storage, targeting
//    the 80% serviced entirely in memory
const MEMORY_RATIO: u8 = 5;

pub struct Query {
    pub user: Option<AccountNumber>,
}

impl Query {
    fn check_user_auth(&self, user: AccountNumber) -> async_graphql::Result<()> {
        if self.user != Some(user) {
            return Err(async_graphql::Error::new(format!(
                "permission denied: '{}' must authorize your app to make this query.",
                user
            )));
        }
        Ok(())
    }

    fn check_users_auth(&self, u1: AccountNumber, u2: AccountNumber) -> async_graphql::Result<()> {
        if self.user != Some(u1) && self.user != Some(u2) {
            return Err(async_graphql::Error::new(format!(
                "permission denied: either '{}' or '{}' must authorize your app to make this query.",
                u1, u2
            )));
        }
        Ok(())
    }
}

#[Object]
impl Query {
    /// Returns the current billing configuration
    async fn get_billing_config(&self) -> Option<BillingConfig> {
        BillingConfigTable::read().get_index_pk().get(&())
    }

    /// Returns the current server specs.
    ///
    /// These specifications are effectively the minimum specs that any full
    /// node must have available.
    ///
    /// `recommended_min_memory_bytes` is the minimum *suggested* amount of memory in bytes
    /// per server. Any less than this amount of memory may result in degraded
    /// node performance.
    async fn get_server_specs(&self) -> ServerSpecs {
        let server_specs: InternalServerSpecs =
            ServerSpecsTable::read().get_index_pk().get(&()).unwrap();

        let network_specs = NetworkSpecsTable::read().get_index_pk().get(&()).unwrap();
        let recommended_min_memory_bytes = network_specs.obj_storage_bytes / MEMORY_RATIO as u64;

        ServerSpecs {
            net_bps: server_specs.net_bps,
            storage_bytes: server_specs.storage_bytes,
            recommended_min_memory_bytes,
        }
    }

    /// Returns the current network variables that are used to derive the network
    /// specs from the server specs.
    async fn get_network_variables(&self) -> NetworkVariables {
        NetworkVariables::get()
    }

    /// Returns the current network specs.
    ///
    /// These are the specifications of the server as perceived by users of the network.
    /// These are therefore the specs that are relevant for metering/billing.
    async fn get_network_specs(&self) -> NetworkSpecs {
        NetworkSpecsTable::read().get_index_pk().get(&()).unwrap()
    }

    /// Returns the data related to pricing of network bandwidth
    async fn network_pricing(&self) -> Option<NetPricing> {
        NetPricing::get()
    }

    /// Returns the data related to pricing of CPU time
    async fn cpu_pricing(&self) -> Option<CpuPricing> {
        CpuPricing::get()
    }

    /// Returns the current amount of resources for the specified user.
    /// The specified user must have authorized the query.
    async fn user_resources(&self, user: AccountNumber) -> async_graphql::Result<UserResources> {
        self.check_user_auth(user)?;

        let p = Tokens::call()
            .getToken(BillingConfig::get_assert().res)
            .precision;

        let balance = crate::Wrapper::call().get_resources(user);
        let settings = UserSettings::get(user);
        let capacity = settings.buffer_capacity.into();

        Ok(UserResources {
            balance: Decimal::new(balance, p),
            buffer_capacity: Decimal::new(capacity, p),
            balance_raw: balance.value,
            buffer_capacity_raw: capacity.value,
            auto_fill: settings.auto_fill,
        })
    }

    /// Returns the history of resource-consumption events for the specified account.
    /// The specified account must have authorized the query.
    async fn consumed_history(
        &self,
        account: AccountNumber,
        first: Option<i32>,
        last: Option<i32>,
        before: Option<String>,
        after: Option<String>,
    ) -> async_graphql::Result<Connection<u64, ConsumptionEvent>> {
        self.check_user_auth(account)?;

        let condition = "account = ?".to_string();
        let param = account.to_string();

        EventQuery::new("history.virtual-server.consumed")
            .condition_with_params(condition, vec![param])
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
    }

    /// Returns the history of events related to the subsidized purchase of resource tokens.
    ///   where the purchaser is different from the recipient.
    ///
    /// Either 'purchaser' or 'recipient' (or both) must be specified.
    /// If one of 'purchaser' or 'recipient' is set, that account must have authorized the query.
    /// If both are set, then either account must have authorized the query.
    async fn subsidy_history(
        &self,
        purchaser: Option<AccountNumber>,
        recipient: Option<AccountNumber>,
        first: Option<i32>,
        last: Option<i32>,
        before: Option<String>,
        after: Option<String>,
    ) -> async_graphql::Result<Connection<u64, SubsidyEvent>> {
        if purchaser.is_none() && recipient.is_none() {
            return Err(async_graphql::Error::new(
                "Either 'purchaser' or 'recipient' (or both) must be specified",
            ));
        }

        match (purchaser.as_ref(), recipient.as_ref()) {
            (Some(p), None) => self.check_user_auth(*p)?,
            (None, Some(r)) => self.check_user_auth(*r)?,
            (Some(p), Some(r)) => self.check_users_auth(*p, *r)?,
            (None, None) => unreachable!(),
        }

        // TODO: Consider how to handle the case where the querier is one of n admins on
        // an app that subsidizes for users and wants to see the subsidy history for the app.

        let mut conditions = Vec::new();
        let mut params = Vec::new();

        if let Some(purchaser) = purchaser {
            conditions.push("purchaser = ?".to_string());
            params.push(purchaser.to_string());
        }

        if let Some(recipient) = recipient {
            conditions.push("recipient = ?".to_string());
            params.push(recipient.to_string());
        }

        EventQuery::new("history.virtual-server.bought")
            .condition_with_params(conditions.join(" AND "), params)
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
    }

    /// Returns the history of block usage events
    ///
    /// One block usage event is emitted every 10 blocks. It contains a summary of the
    /// average resource consumption of the network in the latest block.
    async fn block_usage_history(
        &self,
        first: Option<i32>,
        last: Option<i32>,
        before: Option<String>,
        after: Option<String>,
    ) -> async_graphql::Result<Connection<u64, BlockUsageEvent>> {
        EventQuery::new("history.virtual-server.block_summary")
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
    }
}
