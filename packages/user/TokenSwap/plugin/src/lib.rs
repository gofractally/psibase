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
use psibase::services::tokens::{Decimal, Quantity, TID};

use crate::{
    bindings::{
        exports::token_swap::plugin::liquidity::{Pool as WitPool, ReserveAmount},
        token_swap::plugin::types::Path,
        tokens::plugin::helpers::u64_to_decimal,
    },
    constants::PPM,
    find_path::{find_path, Pool},
    graphql::{fetch_all_pools, GraphQLPool},
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
        High trust grants the abilities
            - Swapping
            - Adding and removal of liquidity to existing or new pools
        ",
    }
    functions {
        None => [quote, quote_pool_tokens, quote_add_liquidity],
        High => [swap, new_pool, add_liquidity, remove_liquidity],
    }
}

struct TokenSwapPlugin;

fn reserve_amount_to_quantity(reserve_amount: ReserveAmount) -> Result<Quantity, Error> {
    decimal_to_u64(reserve_amount.token_id, &reserve_amount.amount).map(|amount| amount.into())
}

fn credit_to_service(deposit: ReserveAmount, memo: &str) -> Result<Quantity, Error> {
    credit(
        deposit.token_id,
        &token_swap::SERVICE.to_string(),
        &deposit.amount,
        memo,
    )?;

    reserve_amount_to_quantity(deposit)
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
        Ok(fetch_all_pools()?
            .into_iter()
            .map(|graph_pool| WitPool::from(graph_pool))
            .collect())
    }
}

impl Swap for TokenSwapPlugin {
    fn quote(
        pools: Option<Vec<WitPool>>,
        from_amount: ReserveAmount,
        to_token: u32,
        slippage: u32,
        max_hops: u8,
    ) -> Result<Path, Error> {
        if slippage > PPM {
            return Err(errors::ErrorType::SlippageTooHigh(slippage).into());
        }

        let pools = if let Some(pools) = pools {
            pools.into_iter().map(|pool| Pool::from(pool)).collect()
        } else {
            fetch_all_pools()?
                .into_iter()
                .map(|pool| Pool::from(pool))
                .collect()
        };

        let (pools, return_amount, slippage_ppm) = find_path(
            pools,
            from_amount.token_id,
            reserve_amount_to_quantity(from_amount)?,
            to_token,
            max_hops,
        );

        if pools.len() == 0 {
            return Err(ErrorType::NoPathFound.into());
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

    fn swap(pools: Vec<String>, amount_in: ReserveAmount, min_return: String) -> Result<(), Error> {
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
    fn new_pool(a_deposit: ReserveAmount, b_deposit: ReserveAmount) -> Result<(), Error> {
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
        first_deposit: ReserveAmount,
        second_deposit: ReserveAmount,
    ) -> Result<(), Error> {
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
        desired_amount: ReserveAmount,
    ) -> Result<String, Error> {
        let a_balance = Decimal::from_str(&pool.a_balance).unwrap();
        let b_balance = Decimal::from_str(&pool.b_balance).unwrap();
        let pool_token_supply = Decimal::from_str(&pool.liquidity_token_supply).unwrap();
        let pool_token_precision = pool_token_supply.precision;

        let wanted_reserve = if desired_amount.token_id == pool.token_a_id {
            a_balance
        } else if desired_amount.token_id == pool.token_b_id {
            b_balance
        } else {
            return Err(ErrorType::InvalidTokenForPool.into());
        };

        let desired_qty = reserve_amount_to_quantity(desired_amount)?;

        let mut required_pool_tokens = mul_div(
            desired_qty,
            pool_token_supply.quantity,
            wanted_reserve.quantity,
        );

        if let Some(user_pool_token_balance) = user_pool_token_balance {
            required_pool_tokens = required_pool_tokens
                .min(decimal_to_u64(pool.liquidity_token, &user_pool_token_balance)?.into())
        }

        Ok(Decimal::new(required_pool_tokens, pool_token_precision).to_string())
    }

    fn remove_liquidity(pool_token_id: TID, amount: String) -> Result<(), Error> {
        let packed_args = token_swap::action_structs::remove_liquidity {
            lp_amount: credit_to_service(
                ReserveAmount {
                    amount,
                    token_id: pool_token_id,
                },
                "Liquidity removal",
            )?,
            pool_id: pool_token_id,
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
    ) -> Result<(ReserveAmount, ReserveAmount), Error> {
        let lp_supply = Decimal::from_str(&pool.liquidity_token_supply).unwrap();

        let liquidity_amount = Quantity::from_str(&amount, lp_supply.precision)
            .map_err(|error| ErrorType::InvalidFormat(error.to_string()))?;

        let a_reserve = Decimal::from_str(&pool.a_balance).unwrap();
        let b_reserve = Decimal::from_str(&pool.b_balance).unwrap();

        let a_amount = mul_div(liquidity_amount, a_reserve.quantity, lp_supply.quantity);
        let b_amount = mul_div(liquidity_amount, b_reserve.quantity, lp_supply.quantity);

        Ok((
            ReserveAmount {
                amount: Decimal::new(a_amount, a_reserve.precision).to_string(),
                token_id: pool.token_a_id,
            },
            ReserveAmount {
                amount: Decimal::new(b_amount, b_reserve.precision).to_string(),
                token_id: pool.token_b_id,
            },
        ))
    }

    fn quote_add_liquidity(pool: WitPool, amount: ReserveAmount) -> Result<String, Error> {
        let (incoming_token, opposing_token) = if pool.token_a_id == amount.token_id {
            (pool.token_a_id, pool.token_b_id)
        } else {
            (pool.token_b_id, pool.token_a_id)
        };

        let quoting_amount = reserve_amount_to_quantity(amount)?;

        let pool = Pool::from(pool);

        let (incoming_reserve, outgoing_reserve) = if incoming_token == pool.token_a {
            (pool.reserve_a, pool.reserve_b)
        } else {
            (pool.reserve_b, pool.reserve_a)
        };

        let expected_balance = mul_div(quoting_amount, outgoing_reserve, incoming_reserve);

        u64_to_decimal(opposing_token, expected_balance.value)
    }
}

bindings::export!(TokenSwapPlugin with_types_in bindings);
