#[allow(warnings)]
mod bindings;

mod find_path;
use std::str::FromStr;

use bindings::exports::token_swap::plugin::liquidity::Guest as Liquidity;
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
        exports::token_swap::plugin::liquidity::{Deposit, Pool as WitPool},
        token_swap::plugin::types::Path,
        tokens::plugin::helpers::u64_to_decimal,
    },
    constants::PPM,
    find_path::{find_path, Pool},
    graphql::fetch_all_pools,
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

fn credit_to_service(deposit: Deposit) -> Result<Quantity, Error> {
    credit(
        deposit.token_id,
        &token_swap::SERVICE.to_string(),
        &deposit.amount,
        "",
    )?;

    Ok(decimal_to_u64(deposit.token_id, &deposit.amount)?.into())
}

impl Swap for TokenSwapPlugin {
    fn quote(
        from_token: u32,
        amount: String,
        to_token: u32,
        slippage: u32,
        max_hops: u8,
    ) -> Result<Path, Error> {
        if slippage > PPM {
            return Err(errors::ErrorType::SlippageTooHigh(slippage).into());
        }

        let pools = fetch_all_pools()?
            .into_iter()
            .map(|pool| pool.into())
            .collect();

        let (pools, return_amount, slippage_ppm) = find_path(
            pools,
            from_token,
            decimal_to_u64(from_token, &amount)?.into(),
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

    fn swap(
        pools: Vec<String>,
        token_in: TID,
        amount_in: String,
        min_return: String,
    ) -> Result<(), Error> {
        if pools.len() == 0 {
            return Err(ErrorType::InsufficientPools.into());
        }
        credit(
            token_in,
            token_swap::SERVICE.to_string().as_str(),
            &amount_in,
            "swap",
        )?;

        let packed_args = token_swap::action_structs::swap {
            amount_in: decimal_to_u64(token_in, &amount_in)?.into(),
            min_return: Decimal::from_str(&min_return).unwrap().quantity,
            pools: pools
                .into_iter()
                .map(|pool_id| pool_id.parse::<u32>().unwrap())
                .collect(),
            token_in,
        }
        .packed();

        add_action_to_transaction(token_swap::action_structs::swap::ACTION_NAME, &packed_args)
    }
}

impl Liquidity for TokenSwapPlugin {
    fn new_pool(first_deposit: Deposit, second_deposit: Deposit) -> Result<(), Error> {
        let packed_args = token_swap::action_structs::new_pool {
            token_a: first_deposit.token_id,
            token_b: second_deposit.token_id,
            token_a_amount: credit_to_service(first_deposit)?,
            token_b_amount: credit_to_service(second_deposit)?,
        }
        .packed();

        add_action_to_transaction(
            token_swap::action_structs::new_pool::ACTION_NAME,
            &packed_args,
        )
    }

    fn add_liquidity(
        pool_id: u32,
        first_deposit: Deposit,
        second_deposit: Deposit,
    ) -> Result<(), Error> {
        let (token_a_deposit, token_b_deposit) = if first_deposit.token_id < second_deposit.token_id
        {
            (first_deposit, second_deposit)
        } else {
            (second_deposit, first_deposit)
        };

        let packed_args = token_swap::action_structs::add_liquidity {
            pool_id,
            amount_a: credit_to_service(token_a_deposit)?,
            amount_b: credit_to_service(token_b_deposit)?,
        }
        .packed();

        add_action_to_transaction(
            token_swap::action_structs::add_liquidity::ACTION_NAME,
            &packed_args,
        )
    }

    fn remove_liquidity(
        pool: WitPool,
        user_pool_token_balance: String,
        desired_token_id: u32,
        desired_amount: String,
    ) -> Result<(), Error> {
        let a_reserve = Decimal::from_str(&pool.a_balance).unwrap();
        let b_reserve = Decimal::from_str(&pool.b_balance).unwrap();
        let pool_token_supply = Decimal::from_str(&pool.liquidity_token_supply).unwrap();

        let user_pool_token_balance = Decimal::from_str(&user_pool_token_balance).unwrap();

        let wanted_reserve = if desired_token_id == pool.token_a_id {
            a_reserve
        } else if desired_token_id == pool.token_b_id {
            b_reserve
        } else {
            return Err(ErrorType::InvalidTokenForPool.into());
        };

        let desired_qty: Quantity = decimal_to_u64(desired_token_id, &desired_amount)?.into();

        let pool_tokens_to_credit = mul_div(
            desired_qty,
            pool_token_supply.quantity,
            wanted_reserve.quantity,
        )
        .min(user_pool_token_balance.quantity);

        credit(
            pool.liquidity_token,
            &token_swap::SERVICE.to_string(),
            &Decimal::new(pool_tokens_to_credit, user_pool_token_balance.precision).to_string(),
            "",
        )?;

        let packed_args = token_swap::action_structs::remove_liquidity {
            lp_amount: pool_tokens_to_credit,
            pool_id: pool.id,
        }
        .packed();

        add_action_to_transaction(
            token_swap::action_structs::remove_liquidity::ACTION_NAME,
            &packed_args,
        )
    }

    fn quote_pool_tokens(pool: WitPool, amount: String) -> Result<(String, String), Error> {
        let lp_supply = Decimal::from_str(&pool.liquidity_token_supply).unwrap();

        let liquidity_amount = Quantity::from_str(&amount, lp_supply.precision)
            .map_err(|error| ErrorType::InvalidFormat(error.to_string()))?;

        let a_reserve = Decimal::from_str(&pool.a_balance).unwrap();
        let b_reserve = Decimal::from_str(&pool.b_balance).unwrap();

        let a_amount = mul_div(liquidity_amount, a_reserve.quantity, lp_supply.quantity);
        let b_amount = mul_div(liquidity_amount, b_reserve.quantity, lp_supply.quantity);

        Ok((
            Decimal::new(a_amount, a_reserve.precision).to_string(),
            Decimal::new(b_amount, b_reserve.precision).to_string(),
        ))
    }

    fn quote_add_liquidity(pool: WitPool, token_id: TID, amount: String) -> Result<String, Error> {
        let (incoming_token, opposing_token) = if pool.token_a_id == token_id {
            (pool.token_a_id, pool.token_b_id)
        } else {
            (pool.token_b_id, pool.token_a_id)
        };

        let quoting_amount: Quantity = decimal_to_u64(incoming_token, &amount)?.into();

        let pool = Pool::from(pool);

        let (incoming_reserve, outgoing_reserve) = if incoming_token == pool.token_a {
            (pool.reserve_a, pool.reserve_b)
        } else {
            (pool.reserve_b, pool.reserve_a)
        };

        let expected_balance = mul_div(quoting_amount, outgoing_reserve, incoming_reserve);

        Ok(u64_to_decimal(opposing_token, expected_balance.value)?.to_string())
    }
}

bindings::export!(TokenSwapPlugin with_types_in bindings);
