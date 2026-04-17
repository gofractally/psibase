use crate::bindings::fractals::plugin as FractalsPlugin;
use crate::bindings::fractals::plugin::queries::{Fractal, Guild};
use crate::bindings::host::types::types::Error;
use crate::bindings::{
    host::common::client::get_receiver, staged_tx::plugin::proposer::set_propose_latch,
};

fn latch(account: &str) -> Result<(), Error> {
    set_propose_latch(Some(account))
}

fn get_fractal() -> Result<Fractal, Error> {
    FractalsPlugin::queries::get_fractal(&get_receiver())
}

fn get_guild(guild_account: &str) -> Result<Guild, Error> {
    FractalsPlugin::queries::get_guild(guild_account)
}

pub fn legislature() -> Result<(), Error> {
    get_fractal().and_then(|fractal| latch(&fractal.legislature))
}

pub fn judiciary() -> Result<(), Error> {
    get_fractal().and_then(|fractal| latch(&fractal.judiciary))
}

pub fn guild(guild_account: &str) -> Result<(), Error> {
    latch(guild_account)
}

pub fn council(guild_account: &str) -> Result<(), Error> {
    get_guild(guild_account).and_then(|guild| latch(&guild.council_role))
}

pub fn representative(guild_account: &str) -> Result<(), Error> {
    get_guild(guild_account).and_then(|guild| latch(&guild.rep_role))
}
