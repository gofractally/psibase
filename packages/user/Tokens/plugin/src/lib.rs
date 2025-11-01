#[allow(warnings)]
mod bindings;

use std::str::FromStr;
mod errors;
use errors::ErrorType;

use bindings::exports::tokens::plugin as Exports;
use Exports::types::Decimal;
use Exports::{
    helpers::Guest as Helpers, issuer::Guest as Issuer, user::Guest as User,
    user_config::Guest as UserConfig,
};

use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use ::tokens::{action_structs as Actions, service::BalanceFlags, service::TokenFlags};
use psibase::services::tokens::Quantity;
use psibase::AccountNumber;
use psibase::{fracpack::Pack, services::tokens, FlagsType};
pub mod query {
    pub mod fetch_token;
}

struct TokensPlugin;

impl TokensPlugin {
    fn set_balance_flag(token_id: u32, flag: BalanceFlags, enable: bool) -> Result<(), Error> {
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

    fn set_token_flag(token_id: u32, flag: TokenFlags, enable: bool) -> Result<(), Error> {
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

impl Issuer for TokensPlugin {
    fn create(precision: u8, max_supply: Decimal) -> Result<(), Error> {
        let max_issued_supply =
            Quantity::from_str(&max_supply, precision.try_into().unwrap()).unwrap();

        let packed_args = Actions::create {
            max_issued_supply,
            precision: precision.try_into().unwrap(),
        }
        .packed();

        add_action_to_transaction(Actions::create::ACTION_NAME, &packed_args)
    }

    fn recall(token_id: u32, amount: Decimal, memo: String, account: String) -> Result<(), Error> {
        let packed_args = Actions::recall {
            amount: Self::decimal_to_u64(token_id, amount)?.into(),
            from: account.as_str().into(),
            memo: memo.try_into().unwrap(),
            token_id,
        }
        .packed();
        add_action_to_transaction(Actions::recall::ACTION_NAME, &packed_args)
    }

    fn mint(token_id: u32, amount: Decimal, memo: String) -> Result<(), Error> {
        let packed_args = Actions::mint {
            amount: Self::decimal_to_u64(token_id, amount)?.into(),
            memo: memo.try_into().unwrap(),
            token_id,
        }
        .packed();
        add_action_to_transaction(Actions::mint::ACTION_NAME, &packed_args)
    }


    fn enable_token_untransferable(token_id: u32, enable: bool) -> Result<(), Error> {
        Self::set_token_flag(token_id, TokenFlags::UNTRANSFERABLE, enable)
    }

    fn enable_token_unrecallable(token_id: u32, enable: bool) -> Result<(), Error> {
        Self::set_token_flag(token_id, TokenFlags::UNRECALLABLE, enable)
    }
}

impl Helpers for TokensPlugin {
    fn decimal_to_u64(token_id: u32, amount: String) -> Result<u64, Error> {
        let token = query::fetch_token::fetch_token(token_id)?;

        Quantity::from_str(&amount, token.precision)
            .map(|amount| amount.value)
            .map_err(|error| Error::from(ErrorType::ConversionError(error.to_string())))
    }

    fn u64_to_decimal(token_id: u32, amount: u64) -> Result<String, Error> {
        let token = query::fetch_token::fetch_token(token_id)?;

        Ok(tokens::Decimal::new(amount.into(), token.precision).to_string())
    }
}

impl User for TokensPlugin {
    fn credit(token_id: u32, debitor: String, amount: Decimal, memo: String) -> Result<(), Error> {
        let packed_args = Actions::credit {
            amount: Self::decimal_to_u64(token_id, amount)?.into(),
            memo: memo.try_into().unwrap(),
            debitor: debitor.as_str().into(),
            token_id,
        }
        .packed();

        add_action_to_transaction(Actions::credit::ACTION_NAME, &packed_args)
    }

    fn uncredit(
        token_id: u32,
        debitor: String,
        amount: Decimal,
        memo: String,
    ) -> Result<(), Error> {
        let packed_args = Actions::uncredit {
            amount: Self::decimal_to_u64(token_id, amount)?.into(),
            memo: memo.try_into().unwrap(),
            debitor: debitor.as_str().into(),
            token_id,
        }
        .packed();

        add_action_to_transaction(Actions::uncredit::ACTION_NAME, &packed_args)
    }

    fn debit(token_id: u32, creditor: String, amount: Decimal, memo: String) -> Result<(), Error> {
        let packed_args = Actions::debit {
            amount: Self::decimal_to_u64(token_id, amount)?.into(),
            creditor: creditor.as_str().into(),
            memo: memo.try_into().unwrap(),
            token_id,
        }
        .packed();

        add_action_to_transaction(Actions::debit::ACTION_NAME, &packed_args)
    }

    fn reject(token_id: u32, creditor: String, memo: String) -> Result<(), Error> {
        let packed_args = Actions::reject {
            creditor: creditor.as_str().into(),
            token_id,
            memo: memo.try_into().unwrap(),
        }
        .packed();

        add_action_to_transaction(Actions::reject::ACTION_NAME, &packed_args)
    }

    fn burn(token_id: u32, amount: Decimal, memo: String) -> Result<(), Error> {
        let packed_args = Actions::burn {
            amount: Self::decimal_to_u64(token_id, amount)?.into(),
            memo: memo.try_into().unwrap(),
            token_id,
        }
        .packed();
        add_action_to_transaction(Actions::burn::ACTION_NAME, &packed_args)
    }
}

impl UserConfig for TokensPlugin {
    fn enable_user_manual_debit(enable: bool) -> Result<(), Error> {
        Self::set_user_flag(BalanceFlags::MANUAL_DEBIT, enable)
    }

    fn enable_user_keep_zero_balances(enable: bool) -> Result<(), Error> {
        Self::set_user_flag(BalanceFlags::KEEP_ZERO_BALANCES, enable)
    }

    fn enable_balance_manual_debit(token_id: u32, enable: bool) -> Result<(), Error> {
        Self::set_balance_flag(token_id, BalanceFlags::MANUAL_DEBIT, enable)
    }

    fn enable_balance_keep_zero_balances(token_id: u32, enable: bool) -> Result<(), Error> {
        Self::set_balance_flag(token_id, BalanceFlags::KEEP_ZERO_BALANCES, enable)
    }

    fn del_balance_config(token_id: u32) -> Result<(), Error> {
        let packed_args = Actions::delBalConf { token_id }.packed();

        add_action_to_transaction(Actions::delBalConf::ACTION_NAME, &packed_args)
    }
}

bindings::export!(TokensPlugin with_types_in bindings);
