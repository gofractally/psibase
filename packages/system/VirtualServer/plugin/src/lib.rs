#[allow(warnings)]
mod bindings;

mod errors;
mod query;
use std::str::FromStr;

use errors::ErrorType;

use bindings::exports::virtual_server::plugin as Exports;
use Exports::types::{CpuPricingParams, NetPricingParams, NetworkVariables, ServerSpecs};
use Exports::{
    admin::Guest as Admin, authorized::Guest as Authorized, billing::Guest as Billing,
    transact::Guest as TransactInterface,
};

use bindings::accounts::plugin as AccountsPlugin;
use bindings::tokens::plugin as TokensPlugin;
use psibase::AccountNumber;
use psibase_plugin::types::Error;
use psibase_plugin::{
    host::{client, server},
    Transact,
};

use psibase::services::tokens::{Precision, Quantity};
use virtual_server::tables::tables::{self as ServiceTables};
use virtual_server::Wrapper as VirtualServer;
use virtual_server::DEFAULT_AUTO_FILL_THRESHOLD_PERCENT;

struct VirtualServerPlugin;

fn assert_caller(allowed: &[&str], context: &str) {
    let sender = client::get_sender();
    assert!(
        allowed.contains(&sender.as_str()),
        "{} can only be called by {:?}",
        context,
        allowed
    );
}

fn to_ppm(pct: String) -> Result<u32, Error> {
    let ppm = Quantity::from_str(&pct, Precision::new(4).unwrap())
        .map(|amount| amount.value)
        .map_err(|error| ErrorType::ConversionError(error.to_string()))?;

    if ppm > 1_000_000 {
        return Err(ErrorType::Overflow.into());
    }

    Ok(ppm as u32)
}

fn get_sys() -> Result<u32, Error> {
    TokensPlugin::helpers::fetch_network_token()?
        .ok_or_else(|| -> Error { ErrorType::NetworkTokenNotFound.into() })
}

impl Admin for VirtualServerPlugin {
    fn init_billing(fee_receiver: String) -> Result<(), Error> {
        assert_caller(&["config"], "init_billing");

        VirtualServer::add_to_tx().init_billing(AccountNumber::from(fee_receiver.as_str()));
        Ok(())
    }

    fn set_specs(specs: ServerSpecs) -> Result<(), Error> {
        assert_caller(&["config"], "set_specs");

        VirtualServer::add_to_tx().set_specs(ServiceTables::ServerSpecs {
            net_bps: specs.net_bps,
            storage_bytes: specs.storage_bytes,
        });
        Ok(())
    }

    fn set_network_variables(variables: NetworkVariables) -> Result<(), Error> {
        assert_caller(&["config"], "set_network_variables");
        VirtualServer::add_to_tx().set_network_variables(ServiceTables::NetworkVariables {
            block_replay_factor: variables.block_replay_factor,
            per_block_sys_cpu_ns: variables.per_block_sys_cpu_ns,
            obj_storage_bytes: variables.obj_storage_bytes,
        });
        Ok(())
    }

    fn enable_billing(enabled: bool) -> Result<(), Error> {
        assert_caller(&["config"], "enable_billing");

        VirtualServer::add_to_tx().enable_billing(enabled);
        Ok(())
    }

    fn set_cpu_pricing_params(params: CpuPricingParams) -> Result<(), Error> {
        assert_caller(&["config"], "set_cpu_pricing_params");

        let add_to_tx = VirtualServer::add_to_tx();
        add_to_tx.cpu_thresholds(to_ppm(params.idle_pct)?, to_ppm(params.congested_pct)?);
        add_to_tx.cpu_rates(params.doubling_time_sec, params.halving_time_sec);
        add_to_tx.cpu_blocks_avg(params.num_blocks_to_average);
        add_to_tx.cpu_min_unit(params.min_billable_unit_ns);

        Ok(())
    }

    fn set_net_pricing_params(params: NetPricingParams) -> Result<(), Error> {
        assert_caller(&["config"], "set_net_pricing_params");

        let add_to_tx = VirtualServer::add_to_tx();
        add_to_tx.net_thresholds(to_ppm(params.idle_pct)?, to_ppm(params.congested_pct)?);
        add_to_tx.net_rates(params.doubling_time_sec, params.halving_time_sec);
        add_to_tx.net_blocks_avg(params.num_blocks_to_average);
        add_to_tx.net_min_unit(params.min_billable_unit_bits);

        Ok(())
    }
}

// Refills to the specified capacity, or if not specified, to the user's current
// buffer capacity.
// If `force` is true, the refill will occur regardless of the user's current balance.
// If `force` is false, the refill will only occur if the user's current resource balance
//   is less than the minimum threshold (a percentage of their total capacity).
fn refill_to_capacity(capacity: Option<u64>, force: bool) -> Result<(), Error> {
    let sys_id = get_sys()?;

    // Calculate amount to refill
    let user = AccountsPlugin::api::get_current_user()
        .ok_or_else(|| -> Error { ErrorType::NotLoggedIn.into() })?;
    let (balance, current_capacity, auto_fill_threshold) = query::get_user_resources(&user)?;
    let capacity = capacity.unwrap_or(current_capacity);

    // If not forcing, only refill if the user's current balance is below minimum
    if !force {
        if auto_fill_threshold == 0 {
            return Ok(());
        }

        let minimum = capacity * auto_fill_threshold / 100;
        if balance >= minimum {
            return Ok(());
        }
    }

    let amount = capacity - balance;
    let amount_str = TokensPlugin::helpers::u64_to_decimal(sys_id, amount)?;

    // Refill
    TokensPlugin::user::credit(
        sys_id,
        &client::get_receiver(),
        &amount_str,
        "Refilling resource buffer",
    )?;
    VirtualServer::add_to_tx().buy_res(Quantity::new(amount));

    Ok(())
}

impl Billing for VirtualServerPlugin {
    fn fill_gas_tank() -> Result<(), Error> {
        assert_caller(
            &["homepage", "config", &client::get_receiver()],
            "fill_gas_tank",
        );

        refill_to_capacity(None, true) // Uses user's current capacity
    }

    fn resize_and_fill_gas_tank(new_capacity: String) -> Result<(), Error> {
        assert_caller(
            &["homepage", &client::get_receiver()],
            "resize_and_fill_gas_tank",
        );

        let sys_id = get_sys()?;
        let capacity = TokensPlugin::helpers::decimal_to_u64(sys_id, &new_capacity)?;
        VirtualServer::add_to_tx().conf_buffer(Some(ServiceTables::BufferConfig {
            capacity,
            threshold_percent: DEFAULT_AUTO_FILL_THRESHOLD_PERCENT,
        }));

        refill_to_capacity(Some(capacity), true)
    }

    fn donate_gas(user: String, amount: String) -> Result<(), Error> {
        assert_caller(&["homepage", &client::get_receiver()], "fill_gas_tank_for");

        let sys_id = get_sys()?;
        let amount_u64 = TokensPlugin::helpers::decimal_to_u64(sys_id, &amount)?;

        TokensPlugin::user::credit(
            sys_id,
            &client::get_receiver(),
            &amount,
            &format!("Subsidizing resources for {}", user),
        )?;

        VirtualServer::add_to_tx().buy_res_for(
            Quantity::new(amount_u64),
            AccountNumber::from_str(&user).unwrap(),
            None,
        );

        Ok(())
    }
}

impl TransactInterface for VirtualServerPlugin {
    fn auto_fill_gas_tank() -> Result<(), Error> {
        assert_caller(&["transact"], "auto_fill_gas_tank");

        if !query::billing_enabled()? || AccountsPlugin::api::get_current_user().is_none() {
            return Ok(());
        }

        refill_to_capacity(None, false)
    }
}

impl Authorized for VirtualServerPlugin {
    fn graphql(query: String) -> Result<String, Error> {
        assert_caller(
            &["homepage", "config", "virtual-server"],
            "authorized::graphql",
        );

        server::post_graphql_get_json(&query)
    }
}

bindings::export!(VirtualServerPlugin with_types_in bindings);
