#[allow(warnings)]
mod bindings;

mod errors;
mod query;
use errors::ErrorType;

use bindings::exports::virtual_server::plugin as Exports;
use Exports::types::{NetworkVariables, ServerSpecs};
use Exports::{admin::Guest as Admin, billing::Guest as Billing};

use bindings::accounts::plugin as AccountsPlugin;
use bindings::host::common::client;
use bindings::host::types::types::Error;
use bindings::tokens::plugin as TokensPlugin;
use bindings::transact::plugin::intf::add_action_to_transaction;
use psibase::fracpack::Pack;
use psibase::AccountNumber;

use virtual_server::action_structs as Actions;
use virtual_server::tables::tables as ServiceTables;

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
}

impl Billing for VirtualServerPlugin {
    fn fill_gas_tank() -> Result<(), Error> {
        assert_caller(
            &["transact", "homepage", "config", &client::get_receiver()],
            "fill_gas_tank",
        );

        let user = AccountsPlugin::api::get_current_user()
            .ok_or_else(|| -> Error { ErrorType::NotLoggedIn.into() })?;

        let (balance, buffer_capacity) = query::get_user_resources(&user)?;

        let minimum = buffer_capacity * 20 / 100;
        if balance < minimum {
            let amount = buffer_capacity - balance;

            let sys_id = TokensPlugin::helpers::fetch_network_token()?
                .ok_or_else(|| -> Error { ErrorType::NetworkTokenNotFound.into() })?;

            let amount = TokensPlugin::helpers::u64_to_decimal(sys_id, amount)?;
            TokensPlugin::user::credit(
                sys_id,
                &client::get_receiver(),
                &amount,
                "Refilling resource buffer",
            )?;
        }

        add_action_to_transaction(
            Actions::refill_res_buf::ACTION_NAME,
            &Actions::refill_res_buf {}.packed(),
        )
    }
}

bindings::export!(VirtualServerPlugin with_types_in bindings);
