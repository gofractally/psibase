#![allow(non_snake_case)]

use crate::Wrapper;
use psibase::services::http_server;
use psibase::*;

pub(super) fn setup_chat_http(chain: &Chain) -> Result<(), psibase::Error> {
    http_server::Wrapper::push_from(chain, Wrapper::SERVICE)
        .registerServer("chat+1".parse().unwrap())
        .get()?;
    chain.finish_block();
    Ok(())
}
