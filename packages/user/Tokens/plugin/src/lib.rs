#[allow(warnings)]
mod bindings;

mod errors;
use errors::ErrorType;

use bindings::exports::tokens::plugin as Exports;
use Exports::types::Decimal;
use Exports::{
    admin::Guest as Admin, authorized::Guest as Authorized, helpers::Guest as Helpers,
    issuer::Guest as Issuer, user::Guest as User, user_config::Guest as UserConfig,
};

use bindings::host::common::server;
use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use ::tokens::{action_structs as Actions, service::BalanceFlags, service::TokenFlags};
use psibase::services::tokens::Quantity;
use psibase::{fracpack::Pack, services::tokens, FlagsType};
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
        assert_authorized(FunctionName::create)?;

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
        let amount = Self::non_zero(token_id, amount)?;
        assert_authorized(FunctionName::recall)?;

        let packed_args = Actions::recall {
            amount,
            from: account.as_str().into(),
            memo: memo.try_into().unwrap(),
            token_id,
        }
        .packed();
        add_action_to_transaction(Actions::recall::ACTION_NAME, &packed_args)
    }

    fn mint(token_id: u32, amount: Decimal, memo: String) -> Result<(), Error> {
        let amount = Self::non_zero(token_id, amount)?;

        assert_authorized(FunctionName::mint)?;

        let packed_args = Actions::mint {
            amount,
            memo: memo.try_into().unwrap(),
            token_id,
        }
        .packed();
        add_action_to_transaction(Actions::mint::ACTION_NAME, &packed_args)
    }

    fn enable_token_untransferable(token_id: u32, enable: bool) -> Result<(), Error> {
        assert_authorized(FunctionName::enable_token_untransferable)?;
        Self::set_token_flag(token_id, TokenFlags::UNTRANSFERABLE, enable)
    }

    fn enable_token_unrecallable(token_id: u32, enable: bool) -> Result<(), Error> {
        assert_authorized(FunctionName::enable_token_unrecallable)?;
        Self::set_token_flag(token_id, TokenFlags::UNRECALLABLE, enable)
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

        Ok(tokens::Decimal::new(amount.into(), token.precision).to_string())
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
    fn credit(token_id: u32, debitor: String, amount: Decimal, memo: String) -> Result<(), Error> {
        let amount = Self::non_zero(token_id, amount)?;
        assert_authorized_with_whitelist(
            FunctionName::credit,
            vec!["homepage".into(), "virtual-server".into(), "invite".into()],
        )?;

        let packed_args = Actions::credit {
            amount,
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
        let amount = Self::non_zero(token_id, amount)?;
        assert_authorized_with_whitelist(FunctionName::uncredit, vec!["homepage".into()])?;

        let packed_args = Actions::uncredit {
            amount,
            memo: memo.try_into().unwrap(),
            debitor: debitor.as_str().into(),
            token_id,
        }
        .packed();

        add_action_to_transaction(Actions::uncredit::ACTION_NAME, &packed_args)
    }

    fn debit(token_id: u32, creditor: String, amount: Decimal, memo: String) -> Result<(), Error> {
        let amount = Self::non_zero(token_id, amount)?;
        assert_authorized_with_whitelist(FunctionName::debit, vec!["homepage".into()])?;

        let packed_args = Actions::debit {
            amount,
            creditor: creditor.as_str().into(),
            memo: memo.try_into().unwrap(),
            token_id,
        }
        .packed();

        add_action_to_transaction(Actions::debit::ACTION_NAME, &packed_args)
    }

    fn reject(token_id: u32, creditor: String, memo: String) -> Result<(), Error> {
        assert_authorized_with_whitelist(FunctionName::reject, vec!["homepage".into()])?;

        let packed_args = Actions::reject {
            creditor: creditor.as_str().into(),
            token_id,
            memo: memo.try_into().unwrap(),
        }
        .packed();

        add_action_to_transaction(Actions::reject::ACTION_NAME, &packed_args)
    }

    fn burn(token_id: u32, amount: Decimal, memo: String) -> Result<(), Error> {
        let amount = Self::non_zero(token_id, amount)?;

        assert_authorized_with_whitelist(FunctionName::burn, vec!["homepage".into()])?;

        let packed_args = Actions::burn {
            amount,
            memo: memo.try_into().unwrap(),
            token_id,
        }
        .packed();
        add_action_to_transaction(Actions::burn::ACTION_NAME, &packed_args)
    }
}

impl UserConfig for TokensPlugin {
    fn enable_user_manual_debit(enable: bool) -> Result<(), Error> {
        assert_authorized_with_whitelist(
            FunctionName::enable_user_manual_debit,
            vec!["homepage".into()],
        )?;
        Self::set_user_flag(BalanceFlags::MANUAL_DEBIT, enable)
    }

    fn enable_user_keep_zero_balances(enable: bool) -> Result<(), Error> {
        assert_authorized_with_whitelist(
            FunctionName::enable_user_keep_zero_balances,
            vec!["homepage".into()],
        )?;
        Self::set_user_flag(BalanceFlags::KEEP_ZERO_BALANCES, enable)
    }

    fn enable_balance_manual_debit(token_id: u32, enable: bool) -> Result<(), Error> {
        assert_authorized_with_whitelist(
            FunctionName::enable_balance_manual_debit,
            vec!["homepage".into()],
        )?;
        Self::set_balance_flag(token_id, BalanceFlags::MANUAL_DEBIT, enable)
    }

    fn enable_balance_keep_zero_balances(token_id: u32, enable: bool) -> Result<(), Error> {
        assert_authorized_with_whitelist(
            FunctionName::enable_balance_keep_zero_balances,
            vec!["homepage".into()],
        )?;
        Self::set_balance_flag(token_id, BalanceFlags::KEEP_ZERO_BALANCES, enable)
    }

    fn del_balance_config(token_id: u32) -> Result<(), Error> {
        assert_authorized_with_whitelist(
            FunctionName::del_balance_config,
            vec!["homepage".into()],
        )?;
        let packed_args = Actions::delBalConf { token_id }.packed();

        add_action_to_transaction(Actions::delBalConf::ACTION_NAME, &packed_args)
    }
}

impl Admin for TokensPlugin {
    fn set_sys_token(token_id: u32) {
        assert_authorized_with_whitelist(FunctionName::set_sys_token, vec!["config".into()])
            .unwrap();

        add_action_to_transaction(
            Actions::setSysToken::ACTION_NAME,
            &Actions::setSysToken { tokenId: token_id }.packed(),
        )
        .unwrap();
    }
}

impl Authorized for TokensPlugin {
    fn graphql(query: String) -> Result<String, Error> {
        assert_authorized_with_whitelist(FunctionName::graphql, vec!["homepage".into()])?;

        server::post_graphql_get_json(&query)
    }
}

bindings::export!(TokensPlugin with_types_in bindings);
