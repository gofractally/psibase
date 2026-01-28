#[allow(warnings)]
mod bindings;
use bindings::*;

use exports::config::plugin::{
    branding::Guest as Branding, packaging::Guest as Packaging, producers::Guest as Producers,
    settings::Guest as Settings, symbol::Guest as Symbol, virtual_server::Guest as VirtualServer,
};
use host::types::types::Error;

use exports::config::plugin::virtual_server::{
    CpuPricingParams, NetPricingParams, NetworkVariables, ServerSpecs,
};

use virtual_server::plugin::types::{
    CpuPricingParams as DestCpuPricingParams, NetPricingParams as DestNetPricingParams,
    NetworkVariables as DestNetworkVariables, ServerSpecs as DestServerSpecs,
};

use staged_tx::plugin::proposer::set_propose_latch;

struct ConfigPlugin;

impl Settings for ConfigPlugin {
    fn set_snapshot_time(seconds: u32) -> Result<(), Error> {
        set_propose_latch(Some("transact"))?;

        transact::plugin::network::set_snapshot_time(seconds)
    }

    fn set_system_token(token_id: u32) -> Result<(), Error> {
        set_propose_latch(Some("tokens"))?;

        Ok(tokens::plugin::admin::set_sys_token(token_id))
    }
}

impl Producers for ConfigPlugin {
    fn set_cft_consensus(prods: Vec<String>) -> Result<(), Error> {
        set_propose_latch(Some("producers"))?;

        producers::plugin::api::set_cft_consensus(&prods[..])
    }

    fn set_bft_consensus(prods: Vec<String>) -> Result<(), Error> {
        set_propose_latch(Some("producers"))?;

        producers::plugin::api::set_bft_consensus(&prods[..])
    }

    fn set_producers(prods: Vec<String>) -> Result<(), Error> {
        set_propose_latch(Some("producers"))?;

        producers::plugin::api::set_producers(&prods[..])
    }

    fn set_max_prods(max_prods: u8) -> Result<(), Error> {
        set_propose_latch(Some("producers"))?;

        producers::plugin::api::set_max_prods(max_prods)
    }
}

impl Branding for ConfigPlugin {
    fn upload_network_logo(logo: Vec<u8>) -> Result<(), Error> {
        set_propose_latch(Some("branding"))?;

        branding::plugin::api::set_logo(&logo);
        Ok(())
    }

    fn set_network_name(name: String) -> Result<(), Error> {
        set_propose_latch(Some("branding"))?;

        branding::plugin::api::set_network_name(&name);
        Ok(())
    }
}

impl Packaging for ConfigPlugin {
    fn set_account_sources(accounts: Vec<String>) -> Result<(), Error> {
        set_propose_latch(Some("root"))?;

        let _ = packages::plugin::private_api::set_account_sources(&accounts);

        Ok(())
    }
}

impl Symbol for ConfigPlugin {
    fn create(symbol: String, recipient: String) -> Result<(), Error> {
        set_propose_latch(Some("symbol"))?;

        symbol::plugin::admin::create(&symbol, &recipient)
    }

    fn sell_length(
        length: u8,
        initial_price: u64,
        target: u32,
        floor_price: u64,
    ) -> Result<(), Error> {
        set_propose_latch(Some("symbol"))?;

        symbol::plugin::admin::sell_length(length, initial_price, target, floor_price)
    }

    fn del_length(length: u8) -> Result<(), Error> {
        set_propose_latch(Some("symbol"))?;

        symbol::plugin::admin::del_length(length)
    }
}

impl VirtualServer for ConfigPlugin {
    fn init_billing(fee_receiver: String) -> Result<(), Error> {
        set_propose_latch(Some("virtual-server"))?;

        virtual_server::plugin::admin::init_billing(&fee_receiver)
    }

    fn set_specs(specs: ServerSpecs) -> Result<(), Error> {
        set_propose_latch(Some("virtual-server"))?;

        let specs = DestServerSpecs {
            net_bps: specs.net_bps,
            storage_bytes: specs.storage_bytes,
        };
        virtual_server::plugin::admin::set_specs(specs)
    }

    fn set_network_variables(variables: NetworkVariables) -> Result<(), Error> {
        set_propose_latch(Some("virtual-server"))?;

        let variables = DestNetworkVariables {
            block_replay_factor: variables.block_replay_factor,
            per_block_sys_cpu_ns: variables.per_block_sys_cpu_ns,
            obj_storage_bytes: variables.obj_storage_bytes,
        };
        virtual_server::plugin::admin::set_network_variables(variables)
    }

    fn enable_billing(enabled: bool) -> Result<(), Error> {
        if enabled {
            virtual_server::plugin::billing::fill_gas_tank()?;
        }

        set_propose_latch(Some("virtual-server"))?;
        virtual_server::plugin::admin::enable_billing(enabled)
    }

    fn set_cpu_pricing_params(params: CpuPricingParams) -> Result<(), Error> {
        set_propose_latch(Some("virtual-server"))?;

        virtual_server::plugin::admin::set_cpu_pricing_params(&DestCpuPricingParams {
            idle_pct: params.idle_pct,
            congested_pct: params.congested_pct,
            doubling_time_sec: params.doubling_time_sec,
            halving_time_sec: params.halving_time_sec,
            num_blocks_to_average: params.num_blocks_to_average,
            min_billable_unit_ns: params.min_billable_unit_ns,
        })
    }

    fn set_net_pricing_params(params: NetPricingParams) -> Result<(), Error> {
        set_propose_latch(Some("virtual-server"))?;

        virtual_server::plugin::admin::set_net_pricing_params(&DestNetPricingParams {
            idle_pct: params.idle_pct,
            congested_pct: params.congested_pct,
            doubling_time_sec: params.doubling_time_sec,
            halving_time_sec: params.halving_time_sec,
            num_blocks_to_average: params.num_blocks_to_average,
            min_billable_unit_bits: params.min_billable_unit_bits,
        })
    }
}

bindings::export!(ConfigPlugin with_types_in bindings);
