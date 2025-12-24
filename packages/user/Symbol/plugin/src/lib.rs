#[allow(warnings)]
mod bindings;

use bindings::exports::symbol::plugin::admin::Guest as Admin;
use bindings::exports::symbol::plugin::api::Guest as Api;

use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;
use psibase::services::tokens;
use psibase::{define_trust, AccountNumber};

use crate::errors::ErrorType;
use crate::graphql::fetch_symbol_owner_nft;

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
        Max => [sell_length, del_length],
    }
}

struct SymbolPlugin;

mod error_codes {
    pub const CREDITING_ZERO_QUANTITY: u32 = 1;
}

impl Api for SymbolPlugin {
    fn create(symbol: String, deposit: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::create)?;

        let billing_token = bindings::tokens::plugin::helpers::fetch_network_token()?
            .ok_or(ErrorType::BillingTokenNotSet)?;

        bindings::tokens::plugin::user::credit(
            billing_token,
            &symbol::Wrapper::SERVICE.to_string(),
            &deposit,
            "".into(),
        )
        .or_else(|error| {
            if error.producer.service == tokens::SERVICE.to_string()
                && error.code == error_codes::CREDITING_ZERO_QUANTITY
            {
                Ok(())
            } else {
                Err(error)
            }
        })?;

        let packed_args = symbol::action_structs::create {
            symbol: AccountNumber::from(symbol.as_str()),
        }
        .packed();
        add_action_to_transaction(symbol::action_structs::create::ACTION_NAME, &packed_args)
    }

    fn map_symbol(token_id: u32, symbol: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::map_symbol)?;

        let nft_id = fetch_symbol_owner_nft(symbol.as_str().into())?;
        bindings::nft::plugin::user::credit(
            nft_id,
            &symbol::SERVICE.to_string(),
            "symbol mapping".into(),
        )?;

        let map_args = symbol::action_structs::mapSymbol {
            token_id,
            symbol: AccountNumber::from(symbol.as_str()),
        }
        .packed();
        add_action_to_transaction(symbol::action_structs::mapSymbol::ACTION_NAME, &map_args)
    }
}

impl Admin for SymbolPlugin {
    fn create(symbol: String, recipient: String) -> Result<(), Error> {
        trust::assert_authorized_with_whitelist(
            trust::FunctionName::create,
            vec!["config".to_string()],
        )?;

        let packed_args = symbol::action_structs::admin_create {
            symbol: AccountNumber::from(symbol.as_str()),
            recipient: AccountNumber::from(recipient.as_str()),
        }
        .packed();
        add_action_to_transaction(
            symbol::action_structs::admin_create::ACTION_NAME,
            &packed_args,
        )
    }

    fn sell_length(
        length: u8,
        initial_price: u64,
        target: u32,
        floor_price: u64,
    ) -> Result<(), Error> {
        trust::assert_authorized_with_whitelist(
            trust::FunctionName::map_symbol,
            vec!["config".to_string()],
        )?;

        let packed_args = symbol::action_structs::sellLength {
            length,
            initial_price: initial_price.into(),
            target,
            floor_price: floor_price.into(),
        }
        .packed();

        add_action_to_transaction(
            symbol::action_structs::sellLength::ACTION_NAME,
            &packed_args,
        )
    }

    fn del_length(length: u8) -> Result<(), Error> {
        trust::assert_authorized_with_whitelist(
            trust::FunctionName::del_length,
            vec!["config".to_string()],
        )?;

        let packed_args = symbol::action_structs::delLength { length }.packed();

        add_action_to_transaction(symbol::action_structs::delLength::ACTION_NAME, &packed_args)
    }
}

bindings::export!(SymbolPlugin with_types_in bindings);
