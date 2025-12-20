use crate::tables::tables::{
    BillingConfig, BillingConfigTable, CpuPricing, NetPricing, NetworkSpecs, NetworkSpecsTable,
    NetworkVariables, ServerSpecs as InternalServerSpecs, ServerSpecsTable,
};
use async_graphql::{connection::Connection, *};
use psibase::{
    check_some,
    services::tokens::{self as Tokens, Decimal, Quantity},
    AccountNumber, EventQuery, Table,
};
use serde::Deserialize;
use serde_aux::field_attributes::deserialize_number_from_string;

pub mod event_types {
    pub const BOUGHT: u8 = 0;
    pub const RECEIVED: u8 = 1;
    pub const CONSUMED_CPU: u8 = 2;
    pub const CONSUMED_NET: u8 = 3;
}

#[derive(Deserialize, SimpleObject)]
#[graphql(complex)]
pub struct ResourcesEvent {
    actor: AccountNumber,
    #[graphql(skip)]
    action: u8,
    #[serde(deserialize_with = "deserialize_number_from_string")]
    amount: u64,
}

#[ComplexObject]
impl ResourcesEvent {
    pub async fn action(&self) -> &'static str {
        match self.action {
            event_types::BOUGHT => "Bought",
            event_types::CONSUMED_CPU => "Consumed CPU",
            event_types::CONSUMED_NET => "Consumed Network Bandwidth",
            _ => "Unknown",
        }
    }
}

#[derive(Deserialize, SimpleObject)]
#[graphql(complex)]
pub struct SubsidizedEvent {
    purchaser: AccountNumber,
    recipient: AccountNumber,
    #[graphql(skip)]
    amount: u64,
    memo: psibase::Memo,
}

#[ComplexObject]
impl SubsidizedEvent {
    pub async fn amount(&self) -> Decimal {
        let config = check_some(BillingConfig::get(), "Billing not initialized");
        let token = Tokens::Wrapper::call().getToken(config.sys);
        Decimal::new(Quantity::from(self.amount), token.precision)
    }
}

#[derive(Deserialize, SimpleObject)]
pub struct ResourceEvent {
    actor: AccountNumber,
    action: String,
    #[serde(deserialize_with = "deserialize_number_from_string")]
    amount: u64,
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

    /// Returns the data relatd to pricing of CPU time
    async fn cpu_pricing(&self) -> Option<CpuPricing> {
        CpuPricing::get()
    }

    /// Returns the history of resource-related events for the specified actor
    /// (i.e. resource purchase, consumption, etc).
    async fn resource_history(
        &self,
        actor: AccountNumber,
        first: Option<i32>,
        last: Option<i32>,
        before: Option<String>,
        after: Option<String>,
    ) -> async_graphql::Result<Connection<u64, ResourceEvent>> {
        let actor = actor.to_string();
        EventQuery::new("history.virtual-server.resources")
            .condition(format!("actor = '{}'", actor))
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
    }

    // Returns the history of events related to subsidizing resource tokens for others.
    async fn resource_subsidies(
        &self,
        purchaser: AccountNumber,
        recipient: Option<AccountNumber>,
        first: Option<i32>,
        last: Option<i32>,
        before: Option<String>,
        after: Option<String>,
    ) -> async_graphql::Result<Connection<u64, SubsidizedEvent>> {
        let mut conditions = Vec::new();
        let mut params = Vec::new();

        conditions.push("purchaser = ?".to_string());
        params.push(purchaser.to_string());

        if let Some(rec) = recipient {
            conditions.push("recipient = ?".to_string());
            params.push(rec.to_string());
        }

        EventQuery::new("history.virtual-server.subsidized")
            .condition_with_params(conditions.join(" AND "), params)
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
    }

    async fn get_resources(&self, user: AccountNumber) -> Quantity {
        crate::Wrapper::call().get_resources(user)
    }
}
