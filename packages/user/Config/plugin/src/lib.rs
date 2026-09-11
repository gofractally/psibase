#[allow(warnings)]
mod bindings;
use bindings::*;

use host::types::types::Error;

use exports::config::plugin::{
    branding::Guest as Branding,
    name_market::{Guest as NameMarket, MarketConfig},
    packaging::Guest as Packaging,
    producers::Guest as Producers,
    settings::Guest as Settings,
    sites::Guest as Sites,
    staged::Guest as Staged,
    symbol::Guest as Symbol,
    tokens::Guest as Tokens,
    transact::Guest as Transact,
    virtual_server::{
        CpuPricingParams, Guest as VirtualServer, NetPricingParams, NetworkVariables, ServerSpecs,
    },
};

use virtual_server::plugin::types::{
    CpuPricingParams as DestCpuPricingParams, NetPricingParams as DestNetPricingParams,
    NetworkVariables as DestNetworkVariables, ServerSpecs as DestServerSpecs,
};

use exports::config::plugin::packaging::{
    Meta, PackageInfo, PackagePreference, PackageSource,
};
use exports::config::plugin::producers::ClaimType;

use transact::plugin::intf::set_propose_latch;

const VIRTUAL_SERVER: &'static str = "vserver";

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

    fn register_candidate(endpoint: String, claim: ClaimType) -> Result<(), Error> {
        producers::plugin::api::register_candidate(&endpoint, &claim)
    }

    fn unregister_candidate() -> Result<(), Error> {
        producers::plugin::api::unregister_candidate();
        Ok(())
    }

    fn graphql(query: String) -> Result<String, Error> {
        producers::plugin::authorized::graphql(&query)
    }
}

impl Branding for ConfigPlugin {
    fn upload_network_logo(logo: Vec<u8>) -> Result<(), Error> {
        set_propose_latch(Some("branding"))?;

        branding::plugin::api::set_logo(&logo);
        Ok(())
    }

    fn set_network_name(name: String) -> Result<(), Error> {
        set_propose_latch(Some("accounts"))?;
        accounts::plugin::admin::preapprove_account(&name);

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

    fn get_sources(owner: String) -> Result<Vec<PackageSource>, Error> {
        packages::plugin::queries::get_sources(&owner)
    }

    fn get_installed_packages() -> Result<Vec<Meta>, Error> {
        packages::plugin::queries::get_installed_packages()
    }

    fn get_available_packages(owner: String) -> Result<Vec<PackageInfo>, Error> {
        packages::plugin::queries::get_available_packages(&owner)
    }

    fn install_packages(
        owner: String,
        pkgs: Vec<String>,
        request_pref: PackagePreference,
        non_request_pref: PackagePreference,
    ) -> Result<(), Error> {
        let index = packages::plugin::queries::get_available_packages(&owner)?;
        let resolved = packages::plugin::private_api::resolve(
            &index,
            &pkgs,
            request_pref,
            non_request_pref,
        )?;
        let ops = packages::plugin::private_api::load_package_ops(&resolved)?;
        let (data, install) =
            packages::plugin::private_api::build_transactions(&owner, &ops, 4)?;
        for tx in data {
            packages::plugin::private_api::push_data(&tx);
        }
        for tx in install {
            packages::plugin::private_api::propose_install(&tx)?;
        }
        Ok(())
    }
}

impl NameMarket for ConfigPlugin {
    fn configure_markets(configs: Vec<MarketConfig>) -> Result<(), Error> {
        if configs.is_empty() {
            return Ok(());
        }

        set_propose_latch(Some("namemarket"))?;

        name_market::plugin::market_admin::configure_markets(&configs)
    }

    fn get_markets_overview() -> Result<name_market::plugin::api::MarketsOverview, Error> {
        name_market::plugin::api::get_markets_overview()
    }

    fn graphql(query: String) -> Result<String, Error> {
        name_market::plugin::authorized::graphql(&query)
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
        set_propose_latch(Some(VIRTUAL_SERVER))?;

        virtual_server::plugin::admin::init_billing(&fee_receiver)
    }

    fn set_specs(specs: ServerSpecs) -> Result<(), Error> {
        set_propose_latch(Some(VIRTUAL_SERVER))?;

        let specs = DestServerSpecs {
            net_bps: specs.net_bps,
            storage_bytes: specs.storage_bytes,
        };
        virtual_server::plugin::admin::set_specs(specs)
    }

    fn set_network_variables(variables: NetworkVariables) -> Result<(), Error> {
        set_propose_latch(Some(VIRTUAL_SERVER))?;

        let variables = DestNetworkVariables {
            block_replay_factor: variables.block_replay_factor,
            per_block_sys_cpu_ns: variables.per_block_sys_cpu_ns,
            obj_storage_bytes: variables.obj_storage_bytes,
            subj_storage_bytes: variables.subj_storage_bytes,
        };
        virtual_server::plugin::admin::set_network_variables(variables)
    }

    fn enable_billing() -> Result<(), Error> {
        virtual_server::plugin::billing::fill_gas_tank()?;

        set_propose_latch(Some(VIRTUAL_SERVER))?;
        virtual_server::plugin::admin::enable_billing()
    }

    fn set_cpu_pricing_params(params: CpuPricingParams) -> Result<(), Error> {
        set_propose_latch(Some(VIRTUAL_SERVER))?;

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
        set_propose_latch(Some(VIRTUAL_SERVER))?;

        virtual_server::plugin::admin::set_net_pricing_params(&DestNetPricingParams {
            idle_pct: params.idle_pct,
            congested_pct: params.congested_pct,
            doubling_time_sec: params.doubling_time_sec,
            halving_time_sec: params.halving_time_sec,
            num_blocks_to_average: params.num_blocks_to_average,
            min_billable_unit_bits: params.min_billable_unit_bits,
        })
    }

    fn get_billing_config() -> Result<virtual_server::plugin::authorized::BillingConfig, Error> {
        virtual_server::plugin::authorized::get_billing_config()
    }

    fn graphql(query: String) -> Result<String, Error> {
        virtual_server::plugin::authorized::graphql(&query)
    }
}

impl Tokens for ConfigPlugin {
    fn get_system_token() -> Result<Option<tokens::plugin::types::SystemTokenInfo>, Error> {
        tokens::plugin::helpers::get_system_token()
    }
}

impl Staged for ConfigPlugin {
    fn accept(id: u32) -> Result<(), Error> {
        staged_tx::plugin::respondent::accept(id)
    }

    fn reject(id: u32) -> Result<(), Error> {
        staged_tx::plugin::respondent::reject(id)
    }

    fn execute(id: u32) -> Result<(), Error> {
        staged_tx::plugin::respondent::execute(id)
    }

    fn remove(id: u32) -> Result<(), Error> {
        staged_tx::plugin::proposer::remove(id)
    }

    fn graphql(query: String) -> Result<String, Error> {
        staged_tx::plugin::authorized::graphql(&query)
    }
}

impl Sites for ConfigPlugin {
    fn graphql(query: String) -> Result<String, Error> {
        sites::plugin::authorized::graphql(&query)
    }
}

impl Transact for ConfigPlugin {
    fn graphql(query: String) -> Result<String, Error> {
        transact::plugin::authorized::graphql(&query)
    }
}

bindings::export!(ConfigPlugin with_types_in bindings);
