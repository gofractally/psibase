#[allow(warnings)]
mod bindings;
use bindings::*;

use exports::clientdata::plugin::keyvalue::Guest as KeyValue;
use exports::clientdata::plugin::tests::Guest as Tests;
use host::common::{
    client::get_sender, store as KvStore, store::Database, store::DbMode, store::StorageDuration,
};
use host::types::types::Error;

mod tests;
use tests::*;

use crate::bindings::host::types::types::PluginId;

struct ClientData;

impl KeyValue for ClientData {
    fn get(key: String) -> Option<Vec<u8>> {
        let db = Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        };
        let bucket = KvStore::Bucket::new(db, &get_sender());

        let record = bucket.get(&key);

        if let Some(value) = record {
            return Some(value);
        }
        None
    }

    fn set(key: String, value: Vec<u8>) {
        let db = Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        };
        let bucket = KvStore::Bucket::new(db, &get_sender());

        // Set the value on the key
        bucket.set(&key, &value)
    }

    fn delete(key: String) {
        let db = Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        };
        let bucket = KvStore::Bucket::new(db, &get_sender());

        bucket.delete(&key);
    }
}

impl Tests for ClientData {
    fn kv_test_step1_tx_fails() -> Result<(), Error> {
        let buckets = get_all_buckets();
        let [nontx_persistent, nontx_session, nontx_ephemeral, tx_persistent, tx_session, tx_ephemeral] =
            buckets.try_into().unwrap();
        standard_test_suite(&nontx_persistent);
        standard_test_suite(&nontx_persistent);
        standard_test_suite(&nontx_persistent);
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

bindings::export!(ClientData with_types_in bindings);
