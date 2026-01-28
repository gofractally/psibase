#[allow(warnings)]
mod bindings;

use bindings::exports::faucet_tok::plugin::faucet::Guest as Faucet;
use bindings::transact::plugin::intf::add_action_to_transaction;
use faucet_tok::action_structs as Actions;
use psibase::fracpack::Pack;
use psibase::AccountNumber;

struct FaucetPlugin;

impl Faucet for FaucetPlugin {
    fn dispense(account: String) {
        add_action_to_transaction(
            Actions::dispense::ACTION_NAME,
            &Actions::dispense {
                account: AccountNumber::from(account.as_str()),
            }
            .packed(),
        )
        .unwrap();
    }
}

bindings::export!(FaucetPlugin with_types_in bindings);
