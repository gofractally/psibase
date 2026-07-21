use std::str::FromStr;

use psibase::{services::guilds::GuildSubaccount, AccountNumber};

use crate::bindings::host::types::types::Error;
use crate::bindings::{
    host::common::client::get_receiver, transact::plugin::intf::set_propose_latch,
};

fn latch(account: &str) -> Result<(), Error> {
    set_propose_latch(Some(account))
}

pub fn fractal() -> Result<(), Error> {
    latch(&get_receiver())
}

pub fn guild(guild_account: &str) -> Result<(), Error> {
    latch(guild_account)
}

pub fn council(guild_account: &str) -> Result<(), Error> {
    let guild_account = AccountNumber::from_str(guild_account).unwrap();
    latch(
        &guild_account
            .with_subaccount(GuildSubaccount::Council.subaccount())
            .to_string(),
    )
}

pub fn representative(guild_account: &str) -> Result<(), Error> {
    let guild_account = AccountNumber::from_str(guild_account).unwrap();
    latch(
        &guild_account
            .with_subaccount(GuildSubaccount::Rep.subaccount())
            .to_string(),
    )
}
