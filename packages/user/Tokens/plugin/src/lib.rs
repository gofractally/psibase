#[allow(warnings)]
mod bindings;

mod errors;
use errors::ErrorType;

use bindings::exports::tokens::plugin as Exports;
use Exports::{
    admin::Guest as Admin, authorized::Guest as Authorized, helpers::Guest as Helpers,
    issuer::Guest as Issuer, user::Guest as User, user_config::Guest as UserConfig,
};

use bindings::host::common::server;
use bindings::host::types::types::Error;

use psibase::services::tokens::{Decimal, Precision, Quantity};
use psibase::FlagsType;
use psibase_plugin::Transact;
use std::str::FromStr;

use tokens::{service::BalanceFlags, service::TokenFlags, Wrapper as Tokens};

pub mod query {
    pub mod fetch_network_token;
    pub mod fetch_token;
}

use crate::trust::*;

psibase::define_trust! {
    descriptions {
        Low => "",
        Medium => "
            - Create new tokens
            - Configure balance and transfer preferences
        ",
        High => "
            - Issue, configure, and manage token and token supply
            - Transfer tokens
            - Configure automatic balance debiting
            - Read your token balances and transaction history
        ",
    }
    functions {
        None => [decimal_to_u64, u64_to_decimal, fetch_network_token],
        Low => [],
        Medium => [create, enable_user_keep_zero_balances, enable_balance_manual_debit, enable_balance_keep_zero_balances, del_balance_config],
        High => [recall, mint, map_symbol, enable_token_untransferable, enable_token_unrecallable, credit, uncredit, debit, reject, burn, enable_user_manual_debit, graphql],
        Max => [set_sys_token],
    }
}

struct TokensPlugin;

fn to_decimal(value: String) -> Decimal {
    Decimal::from_str(value.as_str()).unwrap()
}

impl Issuer for TokensPlugin {
    fn create(precision: u8, max_supply: String) -> Result<(), Error> {
        assert_authorized(FunctionName::create)?;

        let max_supply = to_decimal(max_supply);
        let precision = Precision::new(precision).unwrap();
        Tokens::add_to_tx().create(precision, max_supply.quantity);

        Ok(())
    }

    fn recall(token_id: u32, amount: String, memo: String, account: String) -> Result<(), Error> {
        let amount = Self::non_zero(token_id, amount)?;
        assert_authorized(FunctionName::recall)?;

        Tokens::add_to_tx().recall(
            token_id,
            account.as_str().into(),
            amount,
            memo.as_str().into(),
        );
        Ok(())
    }

    fn mint(token_id: u32, amount: String, memo: String) -> Result<(), Error> {
        assert_authorized(FunctionName::mint)?;

        let amount = Self::non_zero(token_id, amount)?;
        Tokens::add_to_tx().mint(token_id, amount, memo.try_into().unwrap());
        Ok(())
    }

    fn enable_token_untransferable(token_id: u32, enable: bool) -> Result<(), Error> {
        assert_authorized(FunctionName::enable_token_untransferable)?;
        Tokens::add_to_tx().setTokenConf(token_id, TokenFlags::UNTRANSFERABLE.index(), enable);
        Ok(())
    }

    fn enable_token_unrecallable(token_id: u32, enable: bool) -> Result<(), Error> {
        assert_authorized(FunctionName::enable_token_unrecallable)?;
        Tokens::add_to_tx().setTokenConf(token_id, TokenFlags::UNRECALLABLE.index(), enable);
        Ok(())
    }
}

impl Helpers for TokensPlugin {
    fn fetch_network_token() -> Result<Option<u32>, Error> {
        assert_authorized(FunctionName::fetch_network_token)?;
        query::fetch_network_token::fetch_network_token()
            .map_err(|error: ErrorType| Error::from(ErrorType::QueryError(error.to_string())))
    }

    fn decimal_to_u64(token_id: u32, amount: String) -> Result<u64, Error> {
        assert_authorized(FunctionName::decimal_to_u64)?;
        let token = query::fetch_token::fetch_token(token_id)?;

        Quantity::from_str(&amount, token.precision)
            .map(|amount| amount.value)
            .map_err(|error| Error::from(ErrorType::ConversionError(error.to_string())))
    }

    fn u64_to_decimal(token_id: u32, amount: u64) -> Result<String, Error> {
        assert_authorized(FunctionName::u64_to_decimal)?;
        let token = query::fetch_token::fetch_token(token_id)?;

        Ok(Decimal::new(amount.into(), token.precision).to_string())
    }
}

impl TokensPlugin {
    fn non_zero(token_id: u32, amount: String) -> Result<Quantity, Error> {
        Self::decimal_to_u64(token_id, amount).and_then(|value| {
            if value == 0 {
                Err(ErrorType::AmountIsZero.into())
            } else {
                Ok(Quantity::from(value))
            }
        })
    }
}

impl User for TokensPlugin {
    fn credit(token_id: u32, debitor: String, amount: String, memo: String) -> Result<(), Error> {
        assert_authorized_with_whitelist(
            FunctionName::credit,
            vec!["homepage".into(), "virtual-server".into()],
        )?;

        let amount = Self::non_zero(token_id, amount)?;
        let memo = memo.try_into().unwrap();
        Tokens::add_to_tx().credit(token_id, debitor.as_str().into(), amount, memo);
        Ok(())
    }

    fn uncredit(token_id: u32, debitor: String, amount: String, memo: String) -> Result<(), Error> {
        assert_authorized_with_whitelist(FunctionName::uncredit, vec!["homepage".into()])?;

        let amount = Self::non_zero(token_id, amount)?;
        let memo = memo.try_into().unwrap();
        Tokens::add_to_tx().uncredit(token_id, debitor.as_str().into(), amount, memo);
        Ok(())
    }

    fn debit(token_id: u32, creditor: String, amount: String, memo: String) -> Result<(), Error> {
        assert_authorized_with_whitelist(FunctionName::debit, vec!["homepage".into()])?;

        let amount = Self::non_zero(token_id, amount)?;
        let memo = memo.try_into().unwrap();
        Tokens::add_to_tx().debit(token_id, creditor.as_str().into(), amount, memo);
        Ok(())
    }

    fn reject(token_id: u32, creditor: String, memo: String) -> Result<(), Error> {
        assert_authorized_with_whitelist(FunctionName::reject, vec!["homepage".into()])?;
        Tokens::add_to_tx().reject(token_id, creditor.as_str().into(), memo.try_into().unwrap());
        Ok(())
    }

    fn burn(token_id: u32, amount: String, memo: String) -> Result<(), Error> {
        assert_authorized_with_whitelist(FunctionName::burn, vec!["homepage".into()])?;

        let amount = Self::non_zero(token_id, amount)?;
        Tokens::add_to_tx().burn(token_id, amount, memo.try_into().unwrap());
        Ok(())
    }
}

impl UserConfig for TokensPlugin {
    fn enable_user_manual_debit(enable: bool) -> Result<(), Error> {
        assert_authorized_with_whitelist(
            FunctionName::enable_user_manual_debit,
            vec!["homepage".into()],
        )?;
        Tokens::add_to_tx().setUserConf(BalanceFlags::MANUAL_DEBIT.index(), enable);
        Ok(())
    }

    fn enable_user_keep_zero_balances(enable: bool) -> Result<(), Error> {
        assert_authorized_with_whitelist(
            FunctionName::enable_user_keep_zero_balances,
            vec!["homepage".into()],
        )?;
        Tokens::add_to_tx().setUserConf(BalanceFlags::KEEP_ZERO_BALANCES.index(), enable);
        Ok(())
    }

    fn enable_balance_manual_debit(token_id: u32, enable: bool) -> Result<(), Error> {
        assert_authorized_with_whitelist(
            FunctionName::enable_balance_manual_debit,
            vec!["homepage".into()],
        )?;
        Tokens::add_to_tx().setBalConf(token_id, BalanceFlags::MANUAL_DEBIT.index(), enable);
        Ok(())
    }

    fn enable_balance_keep_zero_balances(token_id: u32, enable: bool) -> Result<(), Error> {
        assert_authorized_with_whitelist(
            FunctionName::enable_balance_keep_zero_balances,
            vec!["homepage".into()],
        )?;
        Tokens::add_to_tx().setBalConf(token_id, BalanceFlags::KEEP_ZERO_BALANCES.index(), enable);
        Ok(())
    }

    fn del_balance_config(token_id: u32) -> Result<(), Error> {
        assert_authorized_with_whitelist(
            FunctionName::del_balance_config,
            vec!["homepage".into()],
        )?;
        Tokens::add_to_tx().delBalConf(token_id);
        Ok(())
    }
}

impl Admin for TokensPlugin {
    fn set_sys_token(token_id: u32) {
        assert_authorized_with_whitelist(FunctionName::set_sys_token, vec!["config".into()])
            .unwrap();

        Tokens::add_to_tx().setSysToken(token_id);
    }
}

impl Authorized for TokensPlugin {
    fn graphql(query: String) -> Result<String, Error> {
        assert_authorized_with_whitelist(FunctionName::graphql, vec!["homepage".into()])?;

        server::post_graphql_get_json(&query)
    }
}

bindings::export!(TokensPlugin with_types_in bindings);
