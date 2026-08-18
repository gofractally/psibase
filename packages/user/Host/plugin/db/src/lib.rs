#[allow(warnings)]
mod bindings;
use bindings::*;

mod bucket;

use exports::host::db::store::{DbMode, Guest as Store};
use host::client::api::get_sender;

pub fn check_caller(allowed: &[&str], context: &str) {
    let app = get_sender();
    if !allowed.contains(&app.as_str()) {
        panic!("[{}] Unauthorized caller: {}", context, app);
    }
}

struct HostDb;
impl Store for HostDb {
    type Bucket = bucket::Bucket;

    fn clear_buffers() {
        use crate::bucket::host_buffer;

        check_caller(&["transact"], "clear-buffers@host:db/store");
        host_buffer::clear_all();
    }

    fn flush_transactional_data() {
        use crate::bucket::host_buffer;
        use crate::supervisor::bridge::database as HostDb;

        check_caller(&["transact"], "flush@host:db/store");

        let buffer_data = host_buffer::drain_all(DbMode::Transactional);

        for (db, entries) in buffer_data {
            for (key, op) in entries {
                if let Some(value) = op.0 {
                    HostDb::set(db.duration as u8, &key, &value);
                } else {
                    HostDb::remove(db.duration as u8, &key);
                }
            }
        }
    }
}

bindings::export!(HostDb with_types_in bindings);
