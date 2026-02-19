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
    transact::Guest as Transact,
};

use bindings::accounts::plugin as AccountsPlugin;
use bindings::host::common::{client, server};
use bindings::host::types::types::Error;
use bindings::tokens::plugin as TokensPlugin;
use bindings::transact::plugin::intf::add_action_to_transaction;
use psibase::fracpack::Pack;
use psibase::AccountNumber;

use psibase::services::tokens::{Precision, Quantity};
use virtual_server::action_structs as Actions;
use virtual_server::tables::tables::{self as ServiceTables};
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

fn pct_to_ppm(pct: String) -> Result<u32, Error> {
    let ppm = Quantity::from_str(&pct, Precision::new(4).unwrap())
        .map(|amount| amount.value)
        .map_err(|error| Error::from(ErrorType::ConversionError(error.to_string())))?;

    if ppm > 1_000_000 {
        return Err(ErrorType::Overflow.into());
    }

    Ok(ppm as u32)
}

impl Admin for VirtualServerPlugin {
    fn init_billing(fee_receiver: String) -> Result<(), Error> {
        assert_caller(&["config"], "init_billing");

        add_action_to_transaction(
            Actions::init_billing::ACTION_NAME,
            &Actions::init_billing {
                fee_receiver: AccountNumber::from(fee_receiver.as_str()),
            }
            .packed(),
        )
    }

    fn set_specs(specs: ServerSpecs) -> Result<(), Error> {
        assert_caller(&["config"], "set_specs");

        add_action_to_transaction(
            Actions::set_specs::ACTION_NAME,
            &Actions::set_specs {
                specs: ServiceTables::ServerSpecs {
                    net_bps: specs.net_bps,
                    storage_bytes: specs.storage_bytes,
                },
            }
            .packed(),
        )
    }

    fn set_network_variables(variables: NetworkVariables) -> Result<(), Error> {
        assert_caller(&["config"], "set_network_variables");
        add_action_to_transaction(
            Actions::set_network_variables::ACTION_NAME,
            &Actions::set_network_variables {
                variables: ServiceTables::NetworkVariables {
                    block_replay_factor: variables.block_replay_factor,
                    per_block_sys_cpu_ns: variables.per_block_sys_cpu_ns,
                    obj_storage_bytes: variables.obj_storage_bytes,
                },
            }
            .packed(),
        )
    }

    fn enable_billing(enabled: bool) -> Result<(), Error> {
        assert_caller(&["config"], "enable_billing");

        add_action_to_transaction(
            Actions::enable_billing::ACTION_NAME,
            &Actions::enable_billing { enabled }.packed(),
        )
    }

    fn set_cpu_pricing_params(params: CpuPricingParams) -> Result<(), Error> {
        assert_caller(&["config"], "set_cpu_pricing_params");

        add_action_to_transaction(
            Actions::cpu_thresholds::ACTION_NAME,
            &Actions::cpu_thresholds {
                idle_ppm: pct_to_ppm(params.idle_pct)?,
                congested_ppm: pct_to_ppm(params.congested_pct)?,
            }
            .packed(),
        )?;
        add_action_to_transaction(
            Actions::cpu_rates::ACTION_NAME,
            &Actions::cpu_rates {
                doubling_time_sec: params.doubling_time_sec,
                halving_time_sec: params.halving_time_sec,
            }
            .packed(),
        )?;
        add_action_to_transaction(
            Actions::cpu_blocks_avg::ACTION_NAME,
            &Actions::cpu_blocks_avg {
                num_blocks: params.num_blocks_to_average,
            }
            .packed(),
        )?;
        add_action_to_transaction(
            Actions::cpu_min_unit::ACTION_NAME,
            &Actions::cpu_min_unit {
                ns: params.min_billable_unit_ns,
            }
            .packed(),
        )?;
        Ok(())
    }

    fn set_net_pricing_params(params: NetPricingParams) -> Result<(), Error> {
        assert_caller(&["config"], "set_net_pricing_params");

        add_action_to_transaction(
            Actions::net_thresholds::ACTION_NAME,
            &Actions::net_thresholds {
                idle_ppm: pct_to_ppm(params.idle_pct)?,
                congested_ppm: pct_to_ppm(params.congested_pct)?,
            }
            .packed(),
        )?;
        add_action_to_transaction(
            Actions::net_rates::ACTION_NAME,
            &Actions::net_rates {
                doubling_time_sec: params.doubling_time_sec,
                halving_time_sec: params.halving_time_sec,
            }
            .packed(),
        )?;
        add_action_to_transaction(
            Actions::net_blocks_avg::ACTION_NAME,
            &Actions::net_blocks_avg {
                num_blocks: params.num_blocks_to_average,
            }
            .packed(),
        )?;
        add_action_to_transaction(
            Actions::net_min_unit::ACTION_NAME,
            &Actions::net_min_unit {
                bits: params.min_billable_unit_bits,
            }
            .packed(),
        )?;
        Ok(())
    }
}

// Refills to the specified capacity, or if not specified, to the user's current
// buffer capacity.
// If `force` is true, the refill will occur regardless of the user's current balance.
// If `force` is false, the refill will only occur if the user's current resource balance
//   is less than the minimum threshold (a percentage of their total capacity).
fn refill_to_capacity(capacity: Option<u64>, force: bool) -> Result<(), Error> {
    let sys_id = TokensPlugin::helpers::fetch_network_token()?
        .ok_or_else(|| -> Error { ErrorType::NetworkTokenNotFound.into() })?;

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
    add_action_to_transaction(
        Actions::buy_res::ACTION_NAME,
        &Actions::buy_res {
            amount: Quantity::new(amount),
        }
        .packed(),
    )
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

        let sys_id = TokensPlugin::helpers::fetch_network_token()?
            .ok_or_else(|| -> Error { ErrorType::NetworkTokenNotFound.into() })?;
        let capacity = TokensPlugin::helpers::decimal_to_u64(sys_id, &new_capacity)?;
        add_action_to_transaction(
            Actions::conf_buffer::ACTION_NAME,
            &Actions::conf_buffer {
                config: Some(ServiceTables::BufferConfig {
                    capacity,
                    threshold_percent: DEFAULT_AUTO_FILL_THRESHOLD_PERCENT,
                }),
            }
            .packed(),
        )?;

        refill_to_capacity(Some(capacity), true)
    }

    fn donate_gas(user: String, amount: String) -> Result<(), Error> {
        assert_caller(&["homepage", &client::get_receiver()], "fill_gas_tank_for");

        let sys_id = TokensPlugin::helpers::fetch_network_token()?
            .ok_or_else(|| -> Error { ErrorType::NetworkTokenNotFound.into() })?;

        let amount_u64 = TokensPlugin::helpers::decimal_to_u64(sys_id, &amount)?;

        TokensPlugin::user::credit(
            sys_id,
            &client::get_receiver(),
            &amount,
            &format!("Subsidizing resources for {}", user),
        )?;

        add_action_to_transaction(
            Actions::buy_res_for::ACTION_NAME,
            &Actions::buy_res_for {
                amount: Quantity::new(amount_u64),
                for_user: AccountNumber::from_str(&user).unwrap(),
                memo: None,
            }
            .packed(),
        )
    }
}

impl Transact for VirtualServerPlugin {
    fn auto_fill_gas_tank(account: String) -> Result<(), Error> {
        assert_caller(&["transact"], "auto_fill_gas_tank");

        let user = AccountsPlugin::api::get_current_user();
        if !query::billing_config()?.enabled || user.is_none() || user.unwrap() != account {
            return Ok(());
        }

        refill_to_capacity(None, false)
    }
}

impl Authorized for VirtualServerPlugin {
    fn graphql(query: String) -> Result<String, Error> {
        assert_caller(
            &["homepage", "config", &client::get_receiver()],
            "authorized::graphql",
        );

        server::post_graphql_get_json(&query)
    }
}

bindings::export!(VirtualServerPlugin with_types_in bindings);
