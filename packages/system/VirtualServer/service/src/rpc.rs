use crate::tables::tables::{
    BillingConfig, BillingConfigTable, CpuPricing, NetPricing, NetworkSpecs, NetworkSpecsTable,
    NetworkVariables, ServerSpecs as InternalServerSpecs, ServerSpecsTable,
};
use async_graphql::{connection::Connection, *};
use psibase::{
    services::tokens::{Decimal, Quantity},
    AccountNumber, EventQuery, Table,
};
use serde::Deserialize;
use serde_aux::field_attributes::deserialize_number_from_string;

pub mod resource_events {
    pub const CONSUMED_CPU: u8 = 0;
    pub const CONSUMED_NET: u8 = 1;
    pub const _CONSUMED_STOR: u8 = 2;
    pub const _FREED_STOR: u8 = 3;
}

#[derive(Deserialize, SimpleObject)]
#[graphql(complex)]
pub struct ConsumptionEvent {
    account: AccountNumber,
    #[graphql(skip)]
    resource_event: u8,
    #[serde(deserialize_with = "deserialize_number_from_string")]
    #[graphql(skip)]
    amount: u64,
}

#[ComplexObject]
impl ConsumptionEvent {
    pub async fn event(&self) -> &'static str {
        match self.resource_event {
            resource_events::CONSUMED_CPU => "Consumed CPU",
            resource_events::CONSUMED_NET => "Consumed Network Bandwidth",
            _ => "Unknown",
        }
    }

    pub async fn amount(&self) -> Decimal {
        let token = BillingConfig::get_sys_token();
        Decimal::new(Quantity::from(self.amount), token.precision)
    }
}

#[derive(Deserialize, SimpleObject)]
#[graphql(complex)]
pub struct BoughtEvent {
    purchaser: AccountNumber,
    recipient: AccountNumber,
    #[serde(deserialize_with = "deserialize_number_from_string")]
    #[graphql(skip)]
    amount: u64,
    memo: psibase::Memo,
}

#[ComplexObject]
impl BoughtEvent {
    pub async fn amount(&self) -> Decimal {
        let token = BillingConfig::get_sys_token();
        Decimal::new(Quantity::from(self.amount), token.precision)
    }
}

#[derive(Deserialize, SimpleObject)]
#[graphql(complex)]
pub struct BlockUsageEvent {
    /// The amount of network usage in the block in ppm (parts per million) of total capacity
    net_usage_ppm: u32,
    /// The amount of CPU usage in the block in ppm (parts per million) of total capacity
    cpu_usage_ppm: u32,
}

#[ComplexObject]
impl BlockUsageEvent {
    /// The amount of network usage in the block as a percentage of total capacity
    pub async fn net_usage_pct(&self) -> Decimal {
        Decimal::new(Quantity::from(self.net_usage_ppm), 4.into())
    }

    /// The amount of CPU usage in the block as a percentage of total capacity
    pub async fn cpu_usage_pct(&self) -> Decimal {
        Decimal::new(Quantity::from(self.cpu_usage_ppm), 4.into())
    }
}

#[derive(Deserialize, SimpleObject)]
pub struct ServerSpecs {
    /// Amount of bandwidth capacity per second per server
    pub net_bps: u64,
    /// Amount of storage space in bytes per server
    pub storage_bytes: u64,
    /// Suggested minimum amount of memory in bytes per server
    pub recommended_min_memory_bytes: u64,
}

//  Derived from expected 80% of reads/writes in 20% of the total storage, targeting
//    the 80% serviced entirely in memory
const MEMORY_RATIO: u8 = 5;

pub struct Query;

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

    /// Returns the history of resource-consumption events for the specified actor
    async fn consumed_history(
        &self,
        account: AccountNumber,
        first: Option<i32>,
        last: Option<i32>,
        before: Option<String>,
        after: Option<String>,
    ) -> async_graphql::Result<Connection<u64, ConsumptionEvent>> {
        let condition = "account = '?'".to_string();
        let param = account.to_string();

        EventQuery::new("history.virtual-server.consumed")
            .condition_with_params(condition, vec![param])
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
    }

    // Returns the history of events related to the purchase of resource tokens.
    async fn bought_history(
        &self,
        purchaser: Option<AccountNumber>,
        recipient: Option<AccountNumber>,
        first: Option<i32>,
        last: Option<i32>,
        before: Option<String>,
        after: Option<String>,
    ) -> async_graphql::Result<Connection<u64, BoughtEvent>> {
        if purchaser.is_none() && recipient.is_none() {
            return Err(async_graphql::Error::new(
                "Either 'purchaser' or 'recipient' (or both) must be specified",
            ));
        }

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

    async fn user_resources(&self, user: AccountNumber) -> Quantity {
        crate::Wrapper::call().get_resources(user)
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
