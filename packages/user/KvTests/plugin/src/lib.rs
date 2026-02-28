#[allow(warnings)]
mod bindings;

use bindings::chainmail::plugin as chainmail;
use bindings::exports::kvtests::plugin::tests::Guest as Tests;
use bindings::host::db::store::{self as KvStore, Database, DbMode, StorageDuration};
use bindings::host::types::types::{Error, PluginId};
use bindings::setcode::plugin as setcode;

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
    use setcode::api::set_service_code;
    // Should always fail on the servive because `account` != sender
    set_service_code("made-up-code", "made-up-code".as_bytes());
}

pub fn test_make_successful_tx() {
    use chainmail::api::send;
    send("root", "hi", "message").unwrap();
}

struct KvTestsPlugin;
impl Tests for KvTestsPlugin {
    fn kv_test_step1_tx_fails() -> Result<(), Error> {
        let buckets = get_all_buckets();
        let [nontx_persistent, nontx_session, nontx_ephemeral, tx_persistent, tx_session, tx_ephemeral] =
            buckets.try_into().unwrap();
        standard_test_suite(&nontx_persistent);
        standard_test_suite(&nontx_session);
        standard_test_suite(&nontx_ephemeral);
        standard_test_suite(&tx_persistent);
        standard_test_suite(&tx_session);

        standard_test_suite(&tx_ephemeral);

        test_set(&nontx_persistent, "leftover");
        test_set(&nontx_session, "leftover");
        test_set(&nontx_ephemeral, "leftover");
        test_set(&tx_persistent, "leftover");
        test_set(&tx_session, "leftover");
        test_set(&tx_ephemeral, "leftover");

        test_make_failed_tx();

        // At the end of this test, all data from the standard test suites should be cleaned up,
        //   and "leftover" data should only exist for the non-transactional buckets.
        // This is entirely verified by step2.

        Ok(())
    }

    fn kv_test_step2() -> Result<(), Error> {
        let buckets = get_all_buckets();
        let [nontx_persistent, nontx_session, nontx_ephemeral, tx_persistent, tx_session, tx_ephemeral] =
            buckets.try_into().unwrap();

        // Nothing either ephemeral or transactional should have persisted:
        test_exists(&nontx_persistent, "leftover");
        test_exists(&nontx_session, "leftover");
        test_dne(&nontx_ephemeral, "leftover");
        test_dne(&tx_persistent, "leftover");
        test_dne(&tx_session, "leftover");
        test_dne(&tx_ephemeral, "leftover");

        // Clean up the leftovers
        test_delete(&nontx_persistent, "leftover");
        test_delete(&nontx_session, "leftover");

        // Add some more data
        test_set(&nontx_persistent, "leftover2");
        test_set(&nontx_session, "leftover2");
        test_set(&nontx_ephemeral, "leftover2");
        test_set(&tx_persistent, "leftover2");
        test_set(&tx_session, "leftover2");
        test_set(&tx_ephemeral, "leftover2");

        test_make_successful_tx();

        // At the end of this test, ephemeral data should be deleted (as always) but
        //   all other data should persist.
        // This is entirely verified by step3.

        Ok(())
    }

    fn kv_test_step3_call_fails() -> Result<(), Error> {
        let buckets = get_all_buckets();
        let [nontx_persistent, nontx_session, nontx_ephemeral, tx_persistent, tx_session, tx_ephemeral] =
            buckets.try_into().unwrap();

        // Nothing ephemeral should have persisted:
        test_exists(&nontx_persistent, "leftover2");
        test_exists(&nontx_session, "leftover2");
        test_dne(&nontx_ephemeral, "leftover2");
        test_exists(&tx_persistent, "leftover2");
        test_exists(&tx_session, "leftover2");
        test_dne(&tx_ephemeral, "leftover2");

        // Clean up the leftovers
        test_delete(&nontx_persistent, "leftover2");
        test_delete(&nontx_session, "leftover2");
        test_delete(&tx_persistent, "leftover2");
        test_delete(&tx_session, "leftover2");

        Err(Error {
            code: 0,
            producer: PluginId {
                service: "clientdata".to_string(),
                plugin: "plugin".to_string(),
            },
            message: "Failing intentionally to ensure deletes persist correctly".to_string(),
        })

        // At the end of this step, there should still be leftover2 data in the transactional
        //   buckets. Nothing anywhere else.
        // This is entirely verified by step4.
    }

    fn kv_test_step4() -> Result<(), Error> {
        let buckets = get_all_buckets();
        let [nontx_persistent, nontx_session, nontx_ephemeral, tx_persistent, tx_session, tx_ephemeral] =
            buckets.try_into().unwrap();

        // Nothing either ephemeral or transactional should have persisted:
        test_dne(&nontx_persistent, "leftover2");
        test_dne(&nontx_session, "leftover2");
        test_dne(&nontx_ephemeral, "leftover2");
        test_exists(&tx_persistent, "leftover2");
        test_exists(&tx_session, "leftover2");
        test_dne(&tx_ephemeral, "leftover2");

        // Clean up
        test_delete(&tx_persistent, "leftover2");
        test_delete(&tx_session, "leftover2");

        Ok(())
    }
}

bindings::export!(KvTestsPlugin with_types_in bindings);
