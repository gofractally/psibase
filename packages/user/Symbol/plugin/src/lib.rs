#[allow(warnings)]
mod bindings;

use bindings::exports::symbol::plugin::admin::Guest as Admin;
use bindings::exports::symbol::plugin::api::Guest as Api;

use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use bindings::staged_tx::plugin::proposer::set_propose_latch;
use psibase::fracpack::Pack;
use psibase::services::nft;
use psibase::{define_trust, AccountNumber};

mod errors;
mod graphql;

define_trust! {
    descriptions {
        Low => "",
        Medium => "
        Medium trust grants the abilities
            - Purchase new symbols",
        High => "
        High trust grants the abilities of the Medium trust level, plus these abilities:
            - Map symbols to tokens.",
    }
    functions {
        Medium => [create],
        High => [map_symbol],
        Max => [init],
    }
}

struct SymbolPlugin;

impl Api for SymbolPlugin {
    fn create(symbol: String, deposit: String) -> Result<(), Error> {
        trust::assert_authorized_with_whitelist(
            trust::FunctionName::create,
            vec!["config".to_string()],
        )?;

        bindings::tokens::plugin::user::credit(
            graphql::fetch_config()?.billing_token,
            &symbol::Wrapper::SERVICE.to_string(),
            &deposit,
            "".into(),
        )?;

        let packed_args = symbol::action_structs::create {
            symbol: AccountNumber::from(symbol.as_str()),
        }
        .packed();
        add_action_to_transaction(symbol::action_structs::create::ACTION_NAME, &packed_args)
    }

    fn map_symbol(token_id: u32, symbol: String) -> Result<(), Error> {
        trust::assert_authorized_with_whitelist(
            trust::FunctionName::map_symbol,
            vec!["config".to_string()],
        )?;

        // look up the nft id of the symbol
        // credit the nft to the symbol service
        let credit_args = nft::action_structs::credit {
            nftId: 2,
            memo: "".into(),
            receiver: symbol::SERVICE,
        }
        .packed();

        add_action_to_transaction(nft::action_structs::credit::ACTION_NAME, &credit_args)?;

        let map_args = symbol::action_structs::mapSymbol {
            token_id,
            symbol: AccountNumber::from(symbol.as_str()),
        }
        .packed();
        add_action_to_transaction(symbol::action_structs::mapSymbol::ACTION_NAME, &map_args)
    }
}

impl Admin for SymbolPlugin {
    fn init(token_id: u32) -> Result<(), Error> {
        trust::assert_authorized_with_whitelist(
            trust::FunctionName::init,
            vec!["config".to_string()],
        )?;
        set_propose_latch(Some(&symbol::SERVICE.to_string()))?;

        let packed_args = symbol::action_structs::init {
            billing_token: token_id,
        }
        .packed();
        add_action_to_transaction(symbol::action_structs::init::ACTION_NAME, &packed_args)
    }
}

bindings::export!(SymbolPlugin with_types_in bindings);
