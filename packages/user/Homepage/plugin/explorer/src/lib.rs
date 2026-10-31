#[allow(warnings)]
mod bindings;
use bindings::*;

use explorer::plugin::types::BlockRange;
use exports::homepage::explorer::{authorized::Guest as Authorized, block_log::Guest as BlockLog};
use host::types::types::Error;

fn assert_caller_self() {
    assert_eq!(
        host::client::api::get_sender(),
        host::client::api::get_receiver()
    );
}

struct HomepageExplorerPlugin;

impl BlockLog for HomepageExplorerPlugin {
    fn get_blocks(range: BlockRange) -> Result<String, Error> {
        assert_caller_self();
        explorer::plugin::block_log::get_blocks(&range)
    }
}

impl Authorized for HomepageExplorerPlugin {
    fn graphql(query: String) -> Result<String, Error> {
        assert_caller_self();
        explorer::plugin::authorized::graphql(&query)
    }
}

bindings::export!(HomepageExplorerPlugin with_types_in bindings);
