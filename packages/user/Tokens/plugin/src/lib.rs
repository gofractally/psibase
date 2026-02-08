#[allow(warnings)]
mod bindings;

mod errors;
use errors::ErrorType;

use bindings::exports::tokens::plugin as Exports;
use Exports::{
    admin::Guest as Admin, authorized::Guest as Authorized, helpers::Guest as Helpers,
    issuer::Guest as Issuer, user::Guest as User, user_config::Guest as UserConfig,
};

use psibase::services::tokens::{Decimal, Precision, Quantity};
use psibase::FlagsType;
use psibase_plugin::{trust::*, *};
use std::str::FromStr;

use tokens::{service::BalanceFlags, service::TokenFlags, Wrapper as Tokens};

pub mod query {
    pub mod fetch_network_token;
    pub mod fetch_token;
}

struct TokensPlugin;

impl TrustConfig for TokensPlugin {
    fn capabilities() -> psibase_plugin::trust::Capabilities {
        psibase_plugin::trust::Capabilities {
            low: &[],
            medium: &[
                "Create new tokens",
                "Configure balance and transfer preferences",
            ],
            high: &[
                "Issue, configure, and manage token and token supply",
                "Transfer tokens",
                "Configure automatic balance debiting",
                "Read your token balances and transaction history",
            ],
        }
    }
}

fn to_decimal(value: String) -> Decimal {
    Decimal::from_str(value.as_str()).unwrap()
}

impl Issuer for TokensPlugin {
    #[psibase_plugin::authorized(Medium)]
    fn create(precision: u8, max_supply: String) -> Result<(), Error> {
        let max_supply = to_decimal(max_supply);
        let precision = Precision::new(precision).unwrap();
        Tokens::add_to_tx().create(precision, max_supply.quantity);

        Ok(())
    }

    #[psibase_plugin::authorized(High)]
    fn recall(token_id: u32, amount: String, memo: String, account: String) -> Result<(), Error> {
        let amount = Self::non_zero(token_id, amount)?;

        Tokens::add_to_tx().recall(
            token_id,
            account.as_str().into(),
            amount,
            memo.as_str().into(),
        );
        Ok(())
    }

    #[psibase_plugin::authorized(High)]
    fn mint(token_id: u32, amount: String, memo: String) -> Result<(), Error> {
        let amount = Self::non_zero(token_id, amount)?;
        Tokens::add_to_tx().mint(token_id, amount, memo.try_into().unwrap());
        Ok(())
    }

    #[psibase_plugin::authorized(High)]
    fn enable_token_untransferable(token_id: u32, enable: bool) -> Result<(), Error> {
        Tokens::add_to_tx().setTokenConf(token_id, TokenFlags::UNTRANSFERABLE.index(), enable);
        Ok(())
    }

    #[psibase_plugin::authorized(High)]
    fn enable_token_unrecallable(token_id: u32, enable: bool) -> Result<(), Error> {
        Tokens::add_to_tx().setTokenConf(token_id, TokenFlags::UNRECALLABLE.index(), enable);
        Ok(())
    }
}

impl Helpers for TokensPlugin {
    #[psibase_plugin::authorized(None)]
    fn fetch_network_token() -> Result<Option<u32>, Error> {
        Ok(query::fetch_network_token::fetch_network_token()?)
    }

    #[psibase_plugin::authorized(None)]
    fn decimal_to_u64(token_id: u32, amount: String) -> Result<u64, Error> {
        let token = query::fetch_token::fetch_token(token_id)?;

        Quantity::from_str(&amount, token.precision)
            .map(|amount| amount.value)
            .map_err(|error| Error::from(ErrorType::ConversionError(error.to_string())))
    }

    #[psibase_plugin::authorized(None)]
    fn u64_to_decimal(token_id: u32, amount: u64) -> Result<String, Error> {
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
    #[psibase_plugin::authorized(High, whitelist = ["homepage", "virtual-server"])]
    fn credit(token_id: u32, debitor: String, amount: String, memo: String) -> Result<(), Error> {
        let amount = Self::non_zero(token_id, amount)?;
        let memo = memo.try_into().unwrap();
        Tokens::add_to_tx().credit(token_id, debitor.as_str().into(), amount, memo);
        Ok(())
    }

    #[psibase_plugin::authorized(High, whitelist = ["homepage"])]
    fn uncredit(token_id: u32, debitor: String, amount: String, memo: String) -> Result<(), Error> {
        let amount = Self::non_zero(token_id, amount)?;
        let memo = memo.try_into().unwrap();
        Tokens::add_to_tx().uncredit(token_id, debitor.as_str().into(), amount, memo);
        Ok(())
    }

    #[psibase_plugin::authorized(High, whitelist = ["homepage"])]
    fn debit(token_id: u32, creditor: String, amount: String, memo: String) -> Result<(), Error> {
        let amount = Self::non_zero(token_id, amount)?;
        let memo = memo.try_into().unwrap();
        Tokens::add_to_tx().debit(token_id, creditor.as_str().into(), amount, memo);
        Ok(())
    }

    #[psibase_plugin::authorized(High, whitelist = ["homepage"])]
    fn reject(token_id: u32, creditor: String, memo: String) -> Result<(), Error> {
        Tokens::add_to_tx().reject(token_id, creditor.as_str().into(), memo.try_into().unwrap());
        Ok(())
    }

    #[psibase_plugin::authorized(High, whitelist = ["homepage"])]
    fn burn(token_id: u32, amount: String, memo: String) -> Result<(), Error> {
        let amount = Self::non_zero(token_id, amount)?;
        Tokens::add_to_tx().burn(token_id, amount, memo.try_into().unwrap());
        Ok(())
    }
}

impl UserConfig for TokensPlugin {
    #[psibase_plugin::authorized(High, whitelist = ["homepage"])]
    fn enable_user_manual_debit(enable: bool) -> Result<(), Error> {
        Tokens::add_to_tx().setUserConf(BalanceFlags::MANUAL_DEBIT.index(), enable);
        Ok(())
    }

    #[psibase_plugin::authorized(Medium, whitelist = ["homepage"])]
    fn enable_user_keep_zero_balances(enable: bool) -> Result<(), Error> {
        Tokens::add_to_tx().setUserConf(BalanceFlags::KEEP_ZERO_BALANCES.index(), enable);
        Ok(())
    }

    #[psibase_plugin::authorized(Medium, whitelist = ["homepage"])]
    fn enable_balance_manual_debit(token_id: u32, enable: bool) -> Result<(), Error> {
        Tokens::add_to_tx().setBalConf(token_id, BalanceFlags::MANUAL_DEBIT.index(), enable);
        Ok(())
    }

    #[psibase_plugin::authorized(Medium, whitelist = ["homepage"])]
    fn enable_balance_keep_zero_balances(token_id: u32, enable: bool) -> Result<(), Error> {
        Tokens::add_to_tx().setBalConf(token_id, BalanceFlags::KEEP_ZERO_BALANCES.index(), enable);
        Ok(())
    }

    #[psibase_plugin::authorized(Medium, whitelist = ["homepage"])]
    fn del_balance_config(token_id: u32) -> Result<(), Error> {
        Tokens::add_to_tx().delBalConf(token_id);
        Ok(())
    }
}

impl Admin for TokensPlugin {
    #[psibase_plugin::authorized(Max, whitelist = ["config"])]
    fn set_sys_token(token_id: u32) {
        Tokens::add_to_tx().setSysToken(token_id);
    }
}

impl Authorized for TokensPlugin {
    #[psibase_plugin::authorized(High, whitelist = ["homepage"])]
    fn graphql(query: String) -> Result<String, Error> {
        host::server::post_graphql_get_json(&query)
    }
}

bindings::export!(TokensPlugin with_types_in bindings);
