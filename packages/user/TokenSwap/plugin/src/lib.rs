#[allow(warnings)]
mod bindings;

mod find_path;
use std::str::FromStr;

use bindings::exports::token_swap::plugin::liquidity::Guest as Liquidity;
use bindings::exports::token_swap::plugin::queries::Guest as Queries;
use bindings::exports::token_swap::plugin::swap::Guest as Swap;

use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use bindings::tokens::plugin::helpers::decimal_to_u64;
use bindings::tokens::plugin::user::credit;
use psibase::define_trust;
use psibase::fracpack::Pack;

mod graphql;

mod errors;
use errors::ErrorType;
use psibase::services::tokens::{Decimal, Quantity};

use crate::{
    bindings::{
        exports::token_swap::plugin::liquidity::{Pool as WitPool, TokenAmount},
        token_swap::plugin::types::Path,
        tokens::plugin::helpers::u64_to_decimal,
    },
    constants::PPM,
    find_path::{find_path, GraphPool},
    graphql::{fetch_all_pools, GraphQLPool},
    trust::{assert_authorized_with_whitelist, FunctionName},
};

mod constants {
    pub const PPM: u32 = 1_000_000;
}

pub fn mul_div(a: Quantity, b: Quantity, c: Quantity) -> Quantity {
    let res = (a.value as u128 * b.value as u128) / (c.value as u128);
    (res as u64).into()
}

define_trust! {
    descriptions {
        Low => "",
        Medium => "",
        High => "
            - Performing token swaps
            - Creating new liquidity pools
            - Adding and removing liquidity to / from pools
        ",
    }
    functions {
        None => [quote, quote_pool_tokens, quote_add_liquidity, quote_remove_liquidity, fetch_pools],
        High => [swap, new_pool, add_liquidity, remove_liquidity],
    }
}

struct TokenSwapPlugin;

fn reserve_amount_to_quantity(reserve_amount: TokenAmount) -> Result<Quantity, Error> {
    decimal_to_u64(reserve_amount.token_id, &reserve_amount.amount).map(|amount| amount.into())
}

fn assert_authed(function: FunctionName) -> Result<(), Error> {
    assert_authorized_with_whitelist(function, vec!["homepage".into()])
}

fn credit_to_service(amount: TokenAmount, memo: &str) -> Result<Quantity, Error> {
    credit(
        amount.token_id,
        &token_swap::SERVICE.to_string(),
        &amount.amount,
        memo,
    )?;

    reserve_amount_to_quantity(amount)
}

impl From<GraphQLPool> for WitPool {
    fn from(graph_pool: GraphQLPool) -> Self {
        Self {
            id: graph_pool.liquidity_token,
            liquidity_token: graph_pool.liquidity_token,
            liquidity_token_supply: graph_pool.liquidity_token_supply.to_string(),
            token_a_id: graph_pool.reserve_a.token_id,
            token_a_tariff_ppm: graph_pool.reserve_a.tariff_ppm,
            a_balance: graph_pool.reserve_a.balance.to_string(),
            token_b_id: graph_pool.reserve_b.token_id,
            token_b_tariff_ppm: graph_pool.reserve_b.tariff_ppm,
            b_balance: graph_pool.reserve_b.balance.to_string(),
        }
    }
}

impl Queries for TokenSwapPlugin {
    fn fetch_pools() -> Result<Vec<WitPool>, Error> {
        assert_authed(FunctionName::fetch_pools)?;
        Ok(fetch_all_pools()?
            .into_iter()
            .map(|graph_pool| WitPool::from(graph_pool))
            .collect())
    }
}

impl Swap for TokenSwapPlugin {
    fn quote(
        pools: Option<Vec<WitPool>>,
        from_amount: TokenAmount,
        to_token: u32,
        slippage: u32,
        max_hops: u8,
    ) -> Result<Path, Error> {
        assert_authed(FunctionName::quote)?;
        if slippage > PPM {
            return Err(errors::ErrorType::SlippageTooHigh(slippage).into());
        }

        let pools = if let Some(pools) = pools {
            pools
                .into_iter()
                .map(|pool| GraphPool::from(pool))
                .collect()
        } else {
            fetch_all_pools()?
                .into_iter()
                .map(|pool| GraphPool::from(pool))
                .collect()
        };

        let (pools, return_amount, slippage_ppm, path_was_found) = find_path(
            pools,
            from_amount.token_id,
            reserve_amount_to_quantity(from_amount)?,
            to_token,
            max_hops,
        );

        if pools.len() == 0 {
            if path_was_found {
                return Err(ErrorType::InsffucientLiquidity.into());
            } else {
                return Err(ErrorType::InsufficientPools.into());
            }
        }

        let pool_ids = pools.into_iter().map(|pool| pool.id).collect();

        let tolerable_slippage_amount =
            (return_amount.value as u128 * slippage as u128 / PPM as u128) as u64;

        Ok(Path {
            to_return: u64_to_decimal(to_token, return_amount.value)?,
            minimum_return: u64_to_decimal(
                to_token,
                return_amount.value - tolerable_slippage_amount,
            )?,
            pools: pool_ids,
            slippage: slippage_ppm,
        })
    }

    fn swap(pools: Vec<String>, amount_in: TokenAmount, min_return: String) -> Result<(), Error> {
        assert_authed(FunctionName::swap)?;
        if pools.len() == 0 {
            return Err(ErrorType::InsufficientPools.into());
        }

        let packed_args = token_swap::action_structs::swap {
            token_in: amount_in.token_id,
            amount_in: credit_to_service(amount_in, "Swap")?,
            min_return: Decimal::from_str(&min_return).unwrap().quantity,
            pools: pools
                .into_iter()
                .map(|pool_id| pool_id.parse::<u32>().unwrap())
                .collect(),
        }
        .packed();

        add_action_to_transaction(token_swap::action_structs::swap::ACTION_NAME, &packed_args)
    }
}

impl Liquidity for TokenSwapPlugin {
    fn new_pool(a_deposit: TokenAmount, b_deposit: TokenAmount) -> Result<(), Error> {
        assert_authed(FunctionName::new_pool)?;

        let packed_args = token_swap::action_structs::new_pool {
            token_a: a_deposit.token_id,
            token_b: b_deposit.token_id,
            token_a_amount: credit_to_service(a_deposit, "Initial liquidity deposit")?,
            token_b_amount: credit_to_service(b_deposit, "Initial liquidity deposit")?,
        }
        .packed();

        add_action_to_transaction(
            token_swap::action_structs::new_pool::ACTION_NAME,
            &packed_args,
        )
    }

    fn add_liquidity(
        pool_id: u32,
        first_deposit: TokenAmount,
        second_deposit: TokenAmount,
    ) -> Result<(), Error> {
        assert_authed(FunctionName::add_liquidity)?;
        let (token_a_deposit, token_b_deposit) = if first_deposit.token_id < second_deposit.token_id
        {
            (first_deposit, second_deposit)
        } else {
            (second_deposit, first_deposit)
        };

        let packed_args = token_swap::action_structs::add_liquidity {
            pool_id,
            amount_a: credit_to_service(token_a_deposit, "Liquidity deposit")?,
            amount_b: credit_to_service(token_b_deposit, "Liquidity deposit")?,
        }
        .packed();

        add_action_to_transaction(
            token_swap::action_structs::add_liquidity::ACTION_NAME,
            &packed_args,
        )
    }

    fn quote_remove_liquidity(
        pool: WitPool,
        user_pool_token_balance: Option<String>,
        desired_amount: TokenAmount,
    ) -> Result<(TokenAmount, TokenAmount, TokenAmount), Error> {
        assert_authed(FunctionName::quote_remove_liquidity)?;

        let a_balance = Decimal::from_str(&pool.a_balance).unwrap();
        let b_balance = Decimal::from_str(&pool.b_balance).unwrap();
        let pool_id = pool.id;
        let pool_token_supply = Decimal::from_str(&pool.liquidity_token_supply).unwrap();
        let pool_token_precision = pool_token_supply.precision;
        let pool_token_quantity = pool_token_supply.quantity;

        let wanted_reserve = if desired_amount.token_id == pool.token_a_id {
            a_balance
        } else if desired_amount.token_id == pool.token_b_id {
            b_balance
        } else {
            return Err(ErrorType::TokenDoesNotExist.into());
        };

        let desired_qty = reserve_amount_to_quantity(desired_amount)?;

        let mut required_pool_tokens =
            mul_div(desired_qty, pool_token_quantity, wanted_reserve.quantity);

        if let Some(user_pool_token_balance) = user_pool_token_balance {
            required_pool_tokens = required_pool_tokens
                .min(decimal_to_u64(pool.liquidity_token, &user_pool_token_balance)?.into())
        }

        let pool_tokens_dec = Decimal::new(required_pool_tokens, pool_token_precision).to_string();

        let (a_amount, b_amount) = Self::quote_pool_tokens(pool.into(), pool_tokens_dec.clone())?;

        let pool_token_amount = TokenAmount {
            amount: pool_tokens_dec,
            token_id: pool_id,
        };

        Ok((pool_token_amount, a_amount, b_amount))
    }

    fn remove_liquidity(amount: TokenAmount) -> Result<(), Error> {
        assert_authed(FunctionName::remove_liquidity)?;

        let packed_args = token_swap::action_structs::remove_liquidity {
            pool_id: amount.token_id,
            lp_amount: credit_to_service(amount, "Liquidity removal")?,
        }
        .packed();

        add_action_to_transaction(
            token_swap::action_structs::remove_liquidity::ACTION_NAME,
            &packed_args,
        )
    }

    fn quote_pool_tokens(
        pool: WitPool,
        amount: String,
    ) -> Result<(TokenAmount, TokenAmount), Error> {
        assert_authed(FunctionName::quote_pool_tokens)?;

        let lp_supply = Decimal::from_str(&pool.liquidity_token_supply).unwrap();

        let liquidity_amount = Quantity::from_str(&amount, lp_supply.precision)
            .map_err(|error| ErrorType::InvalidFormat(error.to_string()))?;

        let a_reserve = Decimal::from_str(&pool.a_balance).unwrap();
        let b_reserve = Decimal::from_str(&pool.b_balance).unwrap();

        let a_amount = mul_div(liquidity_amount, a_reserve.quantity, lp_supply.quantity);
        let b_amount = mul_div(liquidity_amount, b_reserve.quantity, lp_supply.quantity);

        Ok((
            TokenAmount {
                amount: Decimal::new(a_amount, a_reserve.precision).to_string(),
                token_id: pool.token_a_id,
            },
            TokenAmount {
                amount: Decimal::new(b_amount, b_reserve.precision).to_string(),
                token_id: pool.token_b_id,
            },
        ))
    }

    fn quote_add_liquidity(pool: WitPool, amount: TokenAmount) -> Result<String, Error> {
        assert_authed(FunctionName::quote_add_liquidity)?;

        let (quoting_token, opposing_token) = if pool.token_a_id == amount.token_id {
            (pool.token_a_id, pool.token_b_id)
        } else if pool.token_b_id == amount.token_id {
            (pool.token_b_id, pool.token_a_id)
        } else {
            return Err(ErrorType::TokenDoesNotExist.into());
        };

        let quoting_amount = reserve_amount_to_quantity(amount)?;

        let pool = GraphPool::from(pool);

        let (quoting_reserve, opposing_reserve) = if quoting_token == pool.token_a {
            (pool.reserve_a, pool.reserve_b)
        } else {
            (pool.reserve_b, pool.reserve_a)
        };

        let expected_balance = mul_div(quoting_amount, opposing_reserve, quoting_reserve);

        u64_to_decimal(opposing_token, expected_balance.value)
    }
}

bindings::export!(TokenSwapPlugin with_types_in bindings);
