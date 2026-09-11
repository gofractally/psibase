#[allow(warnings)]
mod bindings;
use bindings::*;

use exports::homepage::plugin::{
    chainmail::Guest as Chainmail,
    contacts::Guest as Contacts,
    invite::Guest as Invite,
    liquidity::Guest as Liquidity,
    name_market::Guest as NameMarketApi,
    swap::Guest as Swap,
    token_swap::Guest as TokenSwapGraphql,
    tokens::Guest as Tokens,
    vserver::Guest as Vserver,
};
use host::types::types::Error;
use profiles::plugin::types::{Avatar, Contact, Profile};
use token_swap::plugin::types::{Path, Pool, TokenAmount};

const AUTH_SIG_SERVICE: &str = "auth-sig";

struct HomepagePlugin;

impl NameMarketApi for HomepagePlugin {
    fn claim_and_set_key(account: String) -> Result<String, Error> {
        name_market::plugin::api::claim(&account)?;

        let keypair = host::crypto::keyvault::generate_unmanaged_keypair()?;

        transact::plugin::intf::set_propose_latch(Some(&account))?;
        auth_sig::plugin::actions::set_key(&keypair.public_key)?;
        accounts::plugin::api::set_auth_service(AUTH_SIG_SERVICE)?;
        transact::plugin::intf::set_propose_latch(None)?;

        auth_sig::plugin::keyvault::import_key(&keypair.private_key)?;

        Ok(keypair.private_key)
    }

    fn buy(account: String, max_cost: String) -> Result<(), Error> {
        name_market::plugin::api::buy(&account, &max_cost)
    }

    fn can_create_account() -> bool {
        name_market::plugin::api::can_create_account()
    }

    fn get_markets_overview() -> Result<name_market::plugin::api::MarketsOverview, Error> {
        name_market::plugin::api::get_markets_overview()
    }

    fn graphql(query: String) -> Result<String, Error> {
        name_market::plugin::authorized::graphql(&query)
    }
}

impl Tokens for HomepagePlugin {
    fn credit(
        token_id: u32,
        debitor: String,
        amount: String,
        memo: String,
    ) -> Result<(), Error> {
        tokens::plugin::user::credit(token_id, &debitor, &amount, &memo)
    }

    fn uncredit(
        token_id: u32,
        debitor: String,
        amount: String,
        memo: String,
    ) -> Result<(), Error> {
        tokens::plugin::user::uncredit(token_id, &debitor, &amount, &memo)
    }

    fn debit(
        token_id: u32,
        creditor: String,
        amount: String,
        memo: String,
    ) -> Result<(), Error> {
        tokens::plugin::user::debit(token_id, &creditor, &amount, &memo)
    }

    fn reject(token_id: u32, creditor: String, memo: String) -> Result<(), Error> {
        tokens::plugin::user::reject(token_id, &creditor, &memo)
    }

    fn enable_user_auto_debit(enable: bool) -> Result<(), Error> {
        tokens::plugin::user_config::enable_user_auto_debit(enable)
    }

    fn get_system_token() -> Result<Option<tokens::plugin::types::SystemTokenInfo>, Error> {
        tokens::plugin::helpers::get_system_token()
    }

    fn get_user_balances(user: String) -> Result<Vec<tokens::plugin::types::UserBalance>, Error> {
        tokens::plugin::helpers::get_user_balances(&user)
    }

    fn graphql(query: String) -> Result<String, Error> {
        tokens::plugin::authorized::graphql(&query)
    }
}

impl Contacts for HomepagePlugin {
    fn set(contact: Contact, overwrite: bool) -> Result<(), Error> {
        profiles::plugin::contacts::set(&contact, overwrite)
    }

    fn remove(account: String) -> Result<(), Error> {
        profiles::plugin::contacts::remove(&account)
    }

    fn get() -> Result<Vec<Contact>, Error> {
        profiles::plugin::contacts::get()
    }

    fn set_profile(profile: Profile) -> Result<(), Error> {
        profiles::plugin::api::set_profile(&profile)
    }

    fn upload_avatar(avatar: Avatar) -> Result<(), Error> {
        profiles::plugin::api::upload_avatar(&avatar)
    }

    fn remove_avatar() -> Result<(), Error> {
        profiles::plugin::api::remove_avatar()
    }

    fn has_read_permission() -> bool {
        profiles::plugin::api::has_read_permission()
    }
}

impl Chainmail for HomepagePlugin {
    fn get_msgs(
        sender: Option<String>,
        receiver: Option<String>,
    ) -> Result<Vec<chainmail::plugin::types::Message>, Error> {
        chainmail::plugin::queries::get_msgs(sender.as_deref(), receiver.as_deref())
    }

    fn get_archived_msgs(
        sender: Option<String>,
        receiver: Option<String>,
    ) -> Result<Vec<chainmail::plugin::types::Message>, Error> {
        chainmail::plugin::queries::get_archived_msgs(sender.as_deref(), receiver.as_deref())
    }

    fn get_saved_msgs(
        receiver: Option<String>,
    ) -> Result<Vec<chainmail::plugin::types::Message>, Error> {
        chainmail::plugin::queries::get_saved_msgs(receiver.as_deref())
    }

    fn send(receiver: String, subject: String, body: String) -> Result<(), Error> {
        chainmail::plugin::api::send(&receiver, &subject, &body)
    }

    fn archive(msg_id: u64) -> Result<(), Error> {
        chainmail::plugin::api::archive(msg_id)
    }

    fn save(msg_id: u64) -> Result<(), Error> {
        chainmail::plugin::api::save(msg_id)
    }
}

impl Invite for HomepagePlugin {
    fn generate_invite() -> Result<String, Error> {
        invite::plugin::inviter::generate_invite()
    }

    fn import_invite_token(token: String) -> Result<u32, Error> {
        invite::plugin::invitee::import_invite_token(&token)
    }

    fn graphql(query: String) -> Result<String, Error> {
        invite::plugin::authorized::graphql(&query)
    }
}

impl Vserver for HomepagePlugin {
    fn fill_gas_tank() -> Result<(), Error> {
        virtual_server::plugin::billing::fill_gas_tank()
    }

    fn resize_and_fill_gas_tank(new_capacity: String) -> Result<(), Error> {
        virtual_server::plugin::billing::resize_and_fill_gas_tank(&new_capacity)
    }

    fn get_billing_config() -> Result<virtual_server::plugin::authorized::BillingConfig, Error> {
        virtual_server::plugin::authorized::get_billing_config()
    }

    fn graphql(query: String) -> Result<String, Error> {
        virtual_server::plugin::authorized::graphql(&query)
    }
}

impl Swap for HomepagePlugin {
    fn swap(pools: Vec<String>, amount_in: TokenAmount, min_return: String) -> Result<(), Error> {
        token_swap::plugin::swap::swap(&pools, &amount_in, &min_return)
    }

    fn quote(
        pools: Option<Vec<Pool>>,
        from_amount: TokenAmount,
        to_token: u32,
        slippage: u32,
        max_hops: u8,
    ) -> Result<Path, Error> {
        token_swap::plugin::swap::quote(
            pools.as_deref(),
            &from_amount,
            to_token,
            slippage,
            max_hops,
        )
    }
}

impl Liquidity for HomepagePlugin {
    fn add_liquidity(
        pool_id: u32,
        a_deposit: TokenAmount,
        b_deposit: TokenAmount,
    ) -> Result<(), Error> {
        token_swap::plugin::liquidity::add_liquidity(pool_id, &a_deposit, &b_deposit)
    }

    fn quote_add_liquidity(pool: Pool, amount: TokenAmount) -> Result<String, Error> {
        token_swap::plugin::liquidity::quote_add_liquidity(&pool, &amount)
    }

    fn remove_liquidity(amount: TokenAmount) -> Result<(), Error> {
        token_swap::plugin::liquidity::remove_liquidity(&amount)
    }

    fn quote_single_sided_remove(
        pool: Pool,
        user_pool_token_balance: Option<String>,
        desired_amount: TokenAmount,
    ) -> Result<(TokenAmount, TokenAmount, TokenAmount), Error> {
        token_swap::plugin::liquidity::quote_single_sided_remove(
            &pool,
            user_pool_token_balance.as_deref(),
            &desired_amount,
        )
    }

    fn new_pool(
        a_deposit: TokenAmount,
        b_deposit: TokenAmount,
        nft_id: Option<u32>,
    ) -> Result<(), Error> {
        token_swap::plugin::liquidity::new_pool(&a_deposit, &b_deposit, nft_id)
    }

    fn quote_remove_liquidity(
        pool: Pool,
        amount: String,
    ) -> Result<(TokenAmount, TokenAmount), Error> {
        token_swap::plugin::liquidity::quote_remove_liquidity(&pool, &amount)
    }
}

impl TokenSwapGraphql for HomepagePlugin {
    fn graphql(query: String) -> Result<String, Error> {
        token_swap::plugin::authorized::graphql(&query)
    }
}

bindings::export!(HomepagePlugin with_types_in bindings);
