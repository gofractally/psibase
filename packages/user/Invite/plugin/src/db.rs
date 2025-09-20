use crate::*;

use host::common::client as Client;
use host::common::store as Store;

use Store::*;

const DB: Database = Database {
    mode: DbMode::NonTransactional,
    duration: StorageDuration::Session,
};

fn bucket() -> Bucket {
    Bucket::new(DB, "invites")
}

pub struct InviteTokensTable {}
impl InviteTokensTable {
    pub fn import(token: String) {
        bucket().set(&Client::get_sender(), token.as_bytes())
    }

    pub fn get_active_token() -> Option<String> {
        bucket()
            .get(&Client::get_active_app())
            .map(|data| String::from_utf8(data).unwrap())
    }

    pub fn consume_active() {
        bucket().delete(&Client::get_active_app());
    }
}
