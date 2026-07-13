use crate::bindings::guilds::plugin as GuildsPlugin;
use crate::bindings::guilds::plugin::queries::Guild;
use psibase::{AccountNumber, Subaccount};

use crate::bindings::host::types::types::Error;
use crate::bindings::{
    host::common::client::get_receiver, transact::plugin::intf::set_propose_latch,
};

fn latch(account: &str) -> Result<(), Error> {
    set_propose_latch(Some(account))
}

fn get_guild(guild_account: &str) -> Result<Guild, Error> {
    GuildsPlugin::queries::get_guild(guild_account)
}

pub fn fractal() -> Result<(), Error> {
    latch(&get_receiver())
}

pub fn guild(guild_account: &str) -> Result<(), Error> {
    latch(guild_account)
}

pub fn council(guild_account: &str) -> Result<(), Error> {
    let guild_account = AccountNumber::from_str(guild_account).unwrap();
    latch(&guild_account.with_subaccount(Subaccount(1)).to_string())
}

pub fn representative(guild_account: &str) -> Result<(), Error> {
    let guild_account = AccountNumber::from_str(guild_account).unwrap();
    latch(&guild_account.with_subaccount(Subaccount(2)).to_string())
}
