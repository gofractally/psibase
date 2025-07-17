use crate::{Database, DbMode, Error, KvStore, StorageDuration};

pub fn err<'a>(test_name: &'a str) -> impl Fn(Error) -> Error + 'a {
    move |e: Error| {
        eprintln!("[{}] Failed", test_name);
        e
    }
}

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

pub fn standard_test_suite(b: &KvStore::Bucket) -> Result<(), Error> {
    test_set(&b, "1")?;
    test_get(&b, "1")?;
    test_exists(&b, "1")?;
    test_dne(&b, "2")?;
    test_delete(&b, "1")?;
    test_dne(&b, "1")?;
    Ok(())
}

pub fn test_set(b: &KvStore::Bucket, key: &str) -> Result<(), Error> {
    b.set(key, "test value".as_bytes()).map_err(err("set"))?;
    println!("[set] Success. Inserted (\"testkey\", \"test value\")");
    Ok(())
}

pub fn test_get(b: &KvStore::Bucket, key: &str) -> Result<(), Error> {
    let value = b.get(key).map_err(err("get"))?;
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

    Ok(())
}

pub fn test_exists(b: &KvStore::Bucket, key: &str) -> Result<(), Error> {
    let exists = b.exists(key).map_err(err("exists"))?;
    assert!(
        exists,
        "[exists] Failed. Key \"{}\" does not exist, but it should.",
        key
    );
    println!("[exists] Success. Key \"{}\" exists.", key);
    Ok(())
}

pub fn test_dne(b: &KvStore::Bucket, key: &str) -> Result<(), Error> {
    let exists = b.exists(key).map_err(err("dne"))?;
    assert!(
        !exists,
        "[dne] Failed. Key \"{}\" exists, but it should not.",
        key
    );
    println!("[dne] Success. Key \"{}\" does not exist.", key);
    Ok(())
}

pub fn test_delete(b: &KvStore::Bucket, key: &str) -> Result<(), Error> {
    b.delete(key).map_err(err("delete"))?;
    println!("[delete] Success. Key \"{}\" deleted.", key);
    Ok(())
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
