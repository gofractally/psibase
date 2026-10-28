#[allow(warnings)]
mod bindings;
use bindings::*;

mod block_log;
mod decode;
mod errors;

use accounts::query::types::Account;
use auth_dyn::plugin::types::DynamicAuthPolicy;
use explorer::plugin::types::{BlockHeader, BlockRange};
use exports::explorer::plugin::{
    accounts::Guest as Accounts, authorized::Guest as Authorized, block_log::Guest as BlockLog,
    network::Guest as Network, producers::Guest as Producers, registry::Guest as Registry,
    setcode::Guest as Setcode, sites::Guest as Sites, tokens::Guest as Tokens,
    transact::Guest as Transact, virtual_server::Guest as VirtualServer,
};
use host::types::types::Error;
use packages::plugin::types::InstalledPackage;
use psibase::define_trust;
use tokens::plugin::types::{SystemTokenInfo, UserBalance};
use trust::{assert_authorized_with_whitelist, FunctionName};

fn assert_caller_self() {
    assert_eq!(
        host::client::api::get_sender(),
        host::client::api::get_receiver()
    );
}

define_trust! {
    descriptions {
        Low => "",
        Medium => "",
        High => "
            - Reading your transactions in the block log
            - Querying the explorer service with your credentials
        ",
    }
    functions {
        High => [get_blocks, graphql],
    }
}

fn assert_authed(function: FunctionName) -> Result<(), Error> {
    assert_authorized_with_whitelist(function, vec!["homepage".into()])
}

struct ExplorerPlugin;

impl BlockLog for ExplorerPlugin {
    fn get_blocks(range: BlockRange) -> Result<String, Error> {
        assert_authed(FunctionName::get_blocks)?;
        block_log::get_blocks(range)
    }

    fn get_block(block_num: u32) -> Result<Option<String>, Error> {
        assert_caller_self();
        block_log::get_block(block_num)
    }

    fn get_block_summary(block_num: u32) -> Result<Option<String>, Error> {
        assert_caller_self();
        block_log::get_block_summary(block_num)
    }

    fn get_block_header(block_num: u32) -> Result<Option<BlockHeader>, Error> {
        assert_caller_self();
        block_log::get_block_header(block_num)
    }

    fn get_head() -> Result<Option<BlockHeader>, Error> {
        assert_caller_self();
        block_log::get_head()
    }

    fn find_transaction(id: String, max_blocks: Option<u32>) -> Result<Option<String>, Error> {
        assert_caller_self();
        block_log::find_transaction(id, max_blocks)
    }
}

impl Authorized for ExplorerPlugin {
    fn graphql(query: String) -> Result<String, Error> {
        assert_authed(FunctionName::graphql)?;
        host::http::api::post_graphql_get_json(&query)
    }
}

impl Accounts for ExplorerPlugin {
    fn get_account(name: String) -> Result<Option<Account>, Error> {
        assert_caller_self();
        accounts::query::api::get_account(&name)
    }

    fn get_auth_sig_pubkey(account: String) -> Result<Option<String>, Error> {
        assert_caller_self();
        auth_sig::plugin::queries::get_pubkey(&account)
    }

    fn get_accounts_with_key(public_key: String) -> Result<Vec<String>, Error> {
        assert_caller_self();
        auth_sig::plugin::queries::get_accounts_with_key(&public_key)
    }

    fn get_delegate_owner(account: String) -> Result<Option<String>, Error> {
        assert_caller_self();
        auth_delegate::plugin::queries::get_owner(&account)
    }

    fn get_dyn_manager(account: String) -> Result<Option<String>, Error> {
        assert_caller_self();
        auth_dyn::plugin::queries::get_manager(&account)
    }

    fn get_dyn_policy(account: String) -> Result<Option<DynamicAuthPolicy>, Error> {
        assert_caller_self();
        auth_dyn::plugin::queries::get_policy(&account)
    }
}

impl Network for ExplorerPlugin {
    fn get_network_name() -> Result<String, Error> {
        assert_caller_self();
        branding::plugin::queries::get_network_name()
    }

    fn get_installed_packages() -> Result<Vec<InstalledPackage>, Error> {
        assert_caller_self();
        packages::plugin::queries::get_installed()
    }
}

impl Tokens for ExplorerPlugin {
    fn get_system_token() -> Result<Option<SystemTokenInfo>, Error> {
        assert_caller_self();
        tokens::plugin::helpers::get_system_token()
    }

    fn get_user_balances(user: String) -> Result<Vec<UserBalance>, Error> {
        assert_caller_self();
        tokens::plugin::helpers::get_user_balances(&user)
    }

    fn graphql(query: String) -> Result<String, Error> {
        assert_caller_self();
        tokens::plugin::authorized::graphql(&query)
    }
}

impl VirtualServer for ExplorerPlugin {
    fn graphql(query: String) -> Result<String, Error> {
        assert_caller_self();
        virtual_server::plugin::authorized::graphql(&query)
    }
}

impl Producers for ExplorerPlugin {
    fn graphql(query: String) -> Result<String, Error> {
        assert_caller_self();
        producers::plugin::authorized::graphql(&query)
    }
}

impl Setcode for ExplorerPlugin {
    fn graphql(query: String) -> Result<String, Error> {
        assert_caller_self();
        setcode::plugin::authorized::graphql(&query)
    }
}

impl Sites for ExplorerPlugin {
    fn graphql(query: String) -> Result<String, Error> {
        assert_caller_self();
        sites::plugin::authorized::graphql(&query)
    }
}

impl Registry for ExplorerPlugin {
    fn graphql(query: String) -> Result<String, Error> {
        assert_caller_self();
        registry::plugin::authorized::graphql(&query)
    }
}

impl Transact for ExplorerPlugin {
    fn graphql(query: String) -> Result<String, Error> {
        assert_caller_self();
        transact::plugin::authorized::graphql(&query)
    }
}

bindings::export!(ExplorerPlugin with_types_in bindings);
