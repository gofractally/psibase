use crate::bindings::fractals::plugin as FractalsPlugin;
use crate::bindings::fractals::plugin::queries::Fractal;
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

pub fn legislature() -> Result<(), Error> {
    get_fractal().and_then(|fractal| latch(&fractal.legislature))
}

pub fn judiciary() -> Result<(), Error> {
    get_fractal().and_then(|fractal| latch(&fractal.judiciary))
}
