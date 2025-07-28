use crate::{Database, DbMode, KvStore, StorageDuration};

pub fn get_all_buckets() -> Vec<KvStore::Bucket> {
    let nontx_persistent = KvStore::Bucket::new(
        Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        },
        "NONTX_PERSISTENT",
    );
    let nontx_session = KvStore::Bucket::new(
        Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Session,
        },
        "NONTX_SESSION",
    );
    let nontx_ephemeral = KvStore::Bucket::new(
        Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Ephemeral,
        },
        "NONTX_EPHEMERAL",
    );
    let tx_persistent = KvStore::Bucket::new(
        Database {
            mode: DbMode::Transactional,
            duration: StorageDuration::Persistent,
        },
        "TX_PERSISTENT",
    );
    let tx_session = KvStore::Bucket::new(
        Database {
            mode: DbMode::Transactional,
            duration: StorageDuration::Session,
        },
        "TX_SESSION",
    );
    let tx_ephemeral = KvStore::Bucket::new(
        Database {
            mode: DbMode::Transactional,
            duration: StorageDuration::Ephemeral,
        },
        "TX_EPHEMERAL",
    );
    vec![
        nontx_persistent,
        nontx_session,
        nontx_ephemeral,
        tx_persistent,
        tx_session,
        tx_ephemeral,
    ]
}

pub fn standard_test_suite(b: &KvStore::Bucket) {
    test_set(&b, "1");
    test_get(&b, "1");
    test_exists(&b, "1");
    test_dne(&b, "2");
    test_delete(&b, "1");
    test_dne(&b, "1");
}

pub fn test_set(b: &KvStore::Bucket, key: &str) {
    b.set(key, "test value".as_bytes());
    println!("[set] Success. Inserted (\"testkey\", \"test value\")");
}

pub fn test_get(b: &KvStore::Bucket, key: &str) {
    let value = b.get(key);
    assert!(
        value.is_some(),
        "[get] Failed. Value missing for key <\"{}\">",
        key
    );

    let str_value = String::from_utf8(value.unwrap()).expect("Failed to unpack value into string");
    assert!(
        str_value == "test value",
        "[get] Failed. Incorrect string returned."
    );
    println!("[get] Success. [\"{}\"]=\"{}\"", key, str_value);
}

pub fn test_exists(b: &KvStore::Bucket, key: &str) {
    assert!(
        b.exists(key),
        "[exists] Failed. Key \"{}\" does not exist, but it should.",
        key
    );
    println!("[exists] Success. Key \"{}\" exists.", key);
}

pub fn test_dne(b: &KvStore::Bucket, key: &str) {
    assert!(
        !b.exists(key),
        "[dne] Failed. Key \"{}\" exists, but it should not.",
        key
    );
    println!("[dne] Success. Key \"{}\" does not exist.", key);
}

pub fn test_delete(b: &KvStore::Bucket, key: &str) {
    b.delete(key);
    println!("[delete] Success. Key \"{}\" deleted.", key);
}

pub fn test_make_failed_tx() {
    use crate::setcode::plugin::api::set_service_code;
    // Should always fail on the servive because `account` != sender
    set_service_code("made-up-code", "made-up-code".as_bytes());
}

pub fn test_make_successful_tx() {
    use crate::chainmail::plugin::api::send;
    send("root", "hi", "message").unwrap();
}
