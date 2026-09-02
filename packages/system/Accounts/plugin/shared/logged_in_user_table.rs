use crate::bindings::host::db::store::{Bucket, Database, DbMode, StorageDuration};

pub(crate) fn logged_in_user_table() -> Bucket {
    Bucket::new(
        Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        },
        "logged_in_user",
    )
}
