#[allow(warnings)]
mod bindings;

use std::str::FromStr;

use bindings::exports::tokens::plugin as Exports;
use Exports::helpers::Guest as Helpers;
use Exports::intf::Guest as Intf;
use Exports::queries::Guest as Queries;
use Exports::transfer::Guest as Transfer;
use Exports::types as Wit;

use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::{fracpack::Pack, services::tokens::Decimal, FlagsType};
use tokens::{BalanceFlags, TokenFlags, action_structs as Actions};

mod errors;
use errors::ErrorType;
use psibase::services::tokens::quantity::Quantity;
use psibase::AccountNumber;

pub mod query {
    pub mod fetch_token;
}

struct TokensPlugin;

impl TokensPlugin {
    fn set_balance_flag(
        token_id: Wit::TokenId,
        flag: BalanceFlags,
        enable: bool,
    ) -> Result<(), Error> {
        use Actions::setBalConf;

        add_action_to_transaction(
            setBalConf::ACTION_NAME,
            &setBalConf {
                token_id,
                index: flag.index(),
                enabled: enable,
            }
            .packed(),
        )
    }

    fn set_token_flag(
        token_id: Wit::TokenId,
        flag: TokenFlags,
        enable: bool,
    ) -> Result<(), Error> {
        use Actions::setTokenConf;

        add_action_to_transaction(
            setTokenConf::ACTION_NAME,
            &setTokenConf {
                token_id,
                index: flag.index(),
                enabled: enable,
            }
            .packed(),
        )
    }

    fn set_user_flag(flag: BalanceFlags, enable: bool) -> Result<(), Error> {
        use Actions::setUserConf;
        
        add_action_to_transaction(
            setUserConf::ACTION_NAME,
            &setUserConf {
                index: flag.index(),
                enabled: enable,
            }
            .packed(),
        )
    }
}

impl Intf for TokensPlugin {
    fn create(precision: u8, max_issued_supply: Wit::Quantity) -> Result<(), Error> {
        let max_issued_supply =
            Quantity::from_str(&max_issued_supply, precision.try_into().unwrap()).unwrap();

        let packed_args = tokens::action_structs::create {
            max_issued_supply,
            precision: precision.try_into().unwrap(),
        }
        .packed();

        add_action_to_transaction(tokens::action_structs::create::ACTION_NAME, &packed_args)
    }

    fn burn(token_id: Wit::TokenId, amount: Wit::Quantity, memo: String) -> Result<(), Error> {
        let packed_args = tokens::action_structs::burn {
            amount: Self::decimal_to_u64(token_id, amount)?.into(),
            memo: memo.try_into().unwrap(),
            token_id,
        }
        .packed();
        add_action_to_transaction(tokens::action_structs::burn::ACTION_NAME, &packed_args)
    }

    fn recall(
        token_id: Wit::TokenId,
        amount: Wit::Quantity,
        memo: String,
        from: Wit::AccountNumber,
    ) -> Result<(), Error> {
        let packed_args = tokens::action_structs::recall {
            amount: Self::decimal_to_u64(token_id, amount)?.into(),
            from: from.as_str().into(),
            memo: memo.try_into().unwrap(),
            token_id,
        }
        .packed();
        add_action_to_transaction(tokens::action_structs::recall::ACTION_NAME, &packed_args)
    }

    fn map_symbol(token_id: Wit::TokenId, symbol: Wit::AccountNumber) -> Result<(), Error> {
        let packed_args = tokens::action_structs::mapSymbol {
            token_id,
            symbol: AccountNumber::from_str(symbol.as_str()).unwrap(),
        }
        .packed();
        add_action_to_transaction(tokens::action_structs::mapSymbol::ACTION_NAME, &packed_args)
    }

    fn mint(token_id: Wit::TokenId, amount: Wit::Quantity, memo: String) -> Result<(), Error> {
        let packed_args = tokens::action_structs::mint {
            amount: Self::decimal_to_u64(token_id, amount)?.into(),
            memo: memo.try_into().unwrap(),
            token_id,
        }
        .packed();
        add_action_to_transaction(tokens::action_structs::mint::ACTION_NAME, &packed_args)
    }

    fn enable_balance_manual_debit(
        token_id: Wit::TokenId,
        enable: bool,
    ) -> Result<(), Error> {
        Self::set_balance_flag(token_id, BalanceFlags::MANUAL_DEBIT, enable)
    }

    fn enable_balance_keep_zero_balances(
        token_id: Wit::TokenId,
        enable: bool,
    ) -> Result<(), Error> {
        Self::set_balance_flag(token_id, BalanceFlags::KEEP_ZERO_BALANCES, enable)
    }

    fn del_balance_config(token_id: Wit::TokenId) -> Result<(), Error> {
        let packed_args = tokens::action_structs::delBalConf { token_id }.packed();

        add_action_to_transaction(
            tokens::action_structs::delBalConf::ACTION_NAME,
            &packed_args,
        )
    }

    fn enable_token_untransferable(
        token_id: Wit::TokenId,
        enable: bool,
    ) -> Result<(), Error> {
        Self::set_token_flag(token_id, TokenFlags::UNTRANSFERABLE, enable)
    }

    fn enable_token_unrecallable(
        token_id: Wit::TokenId,
        enable: bool,
    ) -> Result<(), Error> {
        Self::set_token_flag(token_id, TokenFlags::UNRECALLABLE, enable)
    }

    fn enable_user_manual_debit(enable: bool) -> Result<(), Error> {
        Self::set_user_flag(BalanceFlags::MANUAL_DEBIT, enable)
    }

    fn enable_user_keep_zero_balances(enable: bool) -> Result<(), Error> {
        Self::set_user_flag(BalanceFlags::KEEP_ZERO_BALANCES, enable)
    }
}

impl Helpers for TokensPlugin {
    fn decimal_to_u64(token_id: Wit::TokenId, amount: Wit::Quantity) -> Result<u64, Error> {
        let token = query::fetch_token::fetch_token(token_id)?;

        Quantity::from_str(&amount, token.precision)
            .map(|amount| amount.value)
            .map_err(|error| Error::from(ErrorType::ConversionError(error.to_string())))
    }

    fn u64_to_decimal(token_id: Wit::TokenId, amount: u64) -> Result<Wit::Quantity, Error> {
        let token = query::fetch_token::fetch_token(token_id)?;

        Ok(Decimal::new(amount.into(), token.precision).to_string())
    }
}

impl Transfer for TokensPlugin {
    fn credit(
        token_id: Wit::TokenId,
        debitor: Wit::AccountNumber,
        amount: Wit::Quantity,
        memo: String,
    ) -> Result<(), Error> {
        let packed_args = tokens::action_structs::credit {
            amount: Self::decimal_to_u64(token_id, amount)?.into(),
            memo: memo.try_into().unwrap(),
            debitor: debitor.as_str().into(),
            token_id,
        }
        .packed();

        add_action_to_transaction(tokens::action_structs::credit::ACTION_NAME, &packed_args)
    }

    fn debit(
        token_id: Wit::TokenId,
        creditor: Wit::AccountNumber,
        amount: Wit::Quantity,
        memo: String,
    ) -> Result<(), Error> {
        let packed_args = tokens::action_structs::debit {
            amount: Self::decimal_to_u64(token_id, amount)?.into(),
            creditor: creditor.as_str().into(),
            memo: memo.try_into().unwrap(),
            token_id,
        }
        .packed();

        add_action_to_transaction(tokens::action_structs::debit::ACTION_NAME, &packed_args)
    }

    fn reject(
        token_id: Wit::TokenId,
        creditor: Wit::AccountNumber,
        memo: String,
    ) -> Result<(), Error> {
        let packed_args = tokens::action_structs::reject {
            creditor: creditor.as_str().into(),
            token_id,
            memo: memo.try_into().unwrap(),
        }
        .packed();

        add_action_to_transaction(tokens::action_structs::reject::ACTION_NAME, &packed_args)
    }

    fn uncredit(
        token_id: Wit::TokenId,
        debitor: Wit::AccountNumber,
        amount: Wit::Quantity,
        memo: String,
    ) -> Result<(), Error> {
        let packed_args = tokens::action_structs::uncredit {
            amount: Self::decimal_to_u64(token_id, amount)?.into(),
            memo: memo.try_into().unwrap(),
            debitor: debitor.as_str().into(),
            token_id,
        }
        .packed();

        add_action_to_transaction(tokens::action_structs::uncredit::ACTION_NAME, &packed_args)
    }
}

impl Queries for TokensPlugin {
    fn token_owner(token_id: Wit::TokenId) -> Result<Wit::TokenDetail, Error> {
        let token = query::fetch_token::fetch_token(token_id)?;

        Ok(Wit::TokenDetail {
            id: token.id,
            owner: token.owner.to_string(),
            symbol_id: token
                .symbol
                .map(|symbol| symbol.to_string())
                .unwrap_or("".to_string()),
            precision: token.precision.value(),
            current_supply: token.current_supply.to_string(),
            max_issued_supply: token.max_issued_supply.to_string(),
        })
    }
}

bindings::export!(TokensPlugin with_types_in bindings);
