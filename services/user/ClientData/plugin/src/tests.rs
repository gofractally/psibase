use crate::{Database, DbMode, Error, KvStore, StorageDuration};

pub fn err<'a>(test_name: &'a str) -> impl Fn(Error) -> Error + 'a {
    move |e: Error| {
        eprintln!("[{}] Failed", test_name);
        e
    }
}

pub fn test_open() -> Result<KvStore::Bucket, Error> {
    let db = Database {
        mode: DbMode::NonTransactional,
        duration: StorageDuration::Persistent,
    };
    let b = KvStore::Bucket::new(db, "test-bucket");
    println!("[open] Success");
    Ok(b)
}

pub fn test_set(b: &KvStore::Bucket) -> Result<(), Error> {
    b.set("testkey", "test value".as_bytes())
        .map_err(err("set"))?;
    println!("[set] Success. Inserted (\"testkey\", \"test value\")");
    Ok(())
}

pub fn test_get(b: &KvStore::Bucket) -> Result<(), Error> {
    let value = b.get("testkey").map_err(err("get"))?;
    assert!(
        value.is_some(),
        "[get] Failed. Value missing for key <\"testkey\">"
    );

    let str_value = String::from_utf8(value.unwrap()).expect("Failed to unpack value into string");
    assert!(
        str_value == "test value",
        "[get] Failed. Incorrect string returned."
    );
    println!("[get] Success. [\"testkey\"]=\"{}\"", str_value);

    Ok(())
}

pub fn test_exists(b: &KvStore::Bucket) -> Result<(), Error> {
    let exists = b.exists("testkey").map_err(err("exists"))?;
    assert!(
        exists,
        "[exists] Failed. Key does not exist, but it should."
    );
    println!("[exists] Success. Key \"testkey\" exists.");
    let exists = b.exists("testkey2").map_err(err("exists"))?;
    assert!(!exists, "[exists] Failed. Key exists, but it should not.");
    println!("[exists] Success. Key \"testkey2\" does not exist.");

    Ok(())
}

pub fn test_delete(b: &KvStore::Bucket) -> Result<(), Error> {
    b.delete("testkey").map_err(err("delete"))?;
    let val = b.exists("testkey").map_err(err("delete:exists"))?;
    assert!(!val, "[delete:exists] Failed. Value exists after delete");
    println!("[delete] Success. \"testkey\" record deleted.");

    b.delete("testkey3").map_err(err("delete_nonexistent"))?;
    println!("[delete] Success. Deleting nonexistent key does nothing.");

    Ok(())
}
