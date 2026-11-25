#[allow(warnings)]
mod bindings;

use bindings::exports::faucet_tok::plugin::faucet::Guest as Faucet;
use bindings::transact::plugin::api::add_action_to_transaction;
use faucet_tok::action_structs as Actions;


struct FaucetPlugin;

impl Faucet for FaucetPlugin {
    fn dispense(account: String) {
        add_action_to_transaction(
            <Actions::dispense as psio::interface::Method>::NAME,
            &psio::to_pssz(&Actions::dispense {
                account: account.parse().unwrap(),
            }),
        )
        .unwrap();
    }
}

bindings::export!(FaucetPlugin with_types_in bindings);
