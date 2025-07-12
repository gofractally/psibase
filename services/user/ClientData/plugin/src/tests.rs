use crate::Kv;

pub fn err<'a>(test_name: &'a str) -> impl Fn(Kv::store::Error) -> Kv::store::Error + 'a {
    move |e: Kv::store::Error| {
        eprintln!("[{}] Failed", test_name);
        e
    }
}

pub fn test_open() -> Result<Kv::store::Bucket, Kv::store::Error> {
    let b = Kv::store::open("test-bucket").map_err(err("open"))?;
    println!("[open] Success");
    Ok(b)
}

pub fn test_set(b: &Kv::store::Bucket) -> Result<(), Kv::store::Error> {
    b.set("testkey", "test value".as_bytes())
        .map_err(err("set"))?;
    println!("[set] Success. Inserted (\"testkey\", \"test value\")");
    Ok(())
}

pub fn test_get(b: &Kv::store::Bucket) -> Result<(), Kv::store::Error> {
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

pub fn test_exists(b: &Kv::store::Bucket) -> Result<(), Kv::store::Error> {
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

pub fn test_delete(b: &Kv::store::Bucket) -> Result<(), Kv::store::Error> {
    b.delete("testkey").map_err(err("delete"))?;
    let val = b.exists("testkey").map_err(err("delete:exists"))?;
    assert!(!val, "[delete:exists] Failed. Value exists after delete");
    println!("[delete] Success. \"testkey\" record deleted.");

    b.delete("testkey3").map_err(err("delete_nonexistent"))?;
    println!("[delete] Success. Deleting nonexistent key does nothing.");

    Ok(())
}

pub fn test_set_many(b: &Kv::store::Bucket) -> Result<(), Kv::store::Error> {
    let key_values = vec![
        ("key1".to_string(), "value1".as_bytes().to_vec()),
        ("key2".to_string(), "value2".as_bytes().to_vec()),
    ];
    Kv::batch::set_many(b, &key_values).map_err(err("set_many"))?;
    println!("[set_many] Success. Inserted (\"key1\", \"value1\"), (\"key2\", \"value2\")");
    Ok(())
}

pub fn test_get_many(b: &Kv::store::Bucket) -> Result<(), Kv::store::Error> {
    let keys = vec!["key1".to_string(), "key2".to_string()];
    let results = Kv::batch::get_many(b, &keys).map_err(err("get_many"))?;
    assert_eq!(
        results.len(),
        2,
        "[get_many] Failure. Incorrect number of results."
    );
    println!("[get_many] Success. Retrieved two records.");
    assert!(
        results.iter().all(|result| result.is_some()),
        "[get_many] Not all keys found"
    );
    let res1 = results
        .get(0)
        .unwrap()
        .as_ref()
        .map(|tuple| tuple.1.clone())
        .unwrap();

    let res1_value = String::from_utf8(res1).expect("Failed to unpack value into string");
    assert_eq!(
        res1_value, "value1",
        "[get] Failed. Expected value1, got {}.",
        res1_value
    );

    let res2 = results
        .get(1)
        .unwrap()
        .as_ref()
        .map(|tuple| tuple.1.clone())
        .unwrap();
    let res2_value = String::from_utf8(res2).expect("Failed to unpack value into string");
    assert_eq!(
        res2_value, "value2",
        "[get] Failed. Expected value1, got {}.",
        res2_value
    );

    println!("[get_many] Success. Both records are correct: (\"key1\", \"value1\"), (\"key2\", \"value2\")");
    Ok(())
}

// pub fn test_list_keys(b: &Kv::store::Bucket) -> Result<(), Kv::store::Error> {
//     let key_response = b.list_keys(None).map_err(err("list_keys"))?;
//     assert!(
//         !key_response.keys.is_empty(),
//         "[list_keys] Failure. No keys found"
//     );
//     assert!(
//         key_response.cursor.is_none(),
//         "[list_keys] Failure. Cursor expected to be empty."
//     );

//     println!(
//         "[list_keys] Success. Retrieved keys: {:?}",
//         key_response.keys
//     );

//     Ok(())
// }

pub fn test_delete_many(b: &Kv::store::Bucket) -> Result<(), Kv::store::Error> {
    let keys = vec!["key1".to_string(), "key2".to_string()];
    Kv::batch::delete_many(b, &keys).map_err(err("delete_many"))?;
    let deleted = Kv::batch::get_many(b, &keys)
        .map_err(err("delete_many:get_many"))?
        .iter()
        .all(|item| item.is_none());
    assert!(deleted, "[delete_many] Failure. Keys not deleted.");

    println!("[delete_many] Success");
    Ok(())
}

pub fn test_increment(b: &Kv::store::Bucket) -> Result<(), Kv::store::Error> {
    let key = "counter";
    let delta = 5;
    b.set(key, "3".as_bytes()).map_err(err("increment:set"))?;
    let new_value = Kv::atomics::increment(b, key, delta).map_err(err("increment"))?;
    println!("[increment] Success, new value: {}", new_value);

    // Clean up the key
    b.delete(key).map_err(err("test_increment:delete"))?;
    Ok(())
}

// pub fn test_pagination(b: &Kv::store::Bucket) -> Result<(), Kv::store::Error> {
//     // Start out empty
//     let key_response = b.list_keys(None).map_err(err("pagination:list_keys"))?;
//     assert_eq!(
//         key_response.keys.len(),
//         0,
//         "Not starting with an empty key set"
//     );

//     let page_limit = 1000;
//     let mut key_values: Vec<(String, Vec<u8>)> = vec![];
//     for i in 0..page_limit {
//         key_values.push((
//             format!("key-{}", i),
//             (format!("val-{}", i).as_bytes()).to_vec(),
//         ));
//     }
//     Kv::batch::set_many(b, &key_values).map_err(err("pagination:set_many"))?;
//     let key_response = b.list_keys(None).map_err(err("pagination:list_keys"))?;
//     assert_eq!(
//         key_response.keys.len(),
//         1000,
//         "[pagination] Failure. Expected 1000 keys, only got {}",
//         key_response.keys.len()
//     );
//     assert!(
//         key_response.cursor.is_none(),
//         "[pagination] Failure. Cursor expected to be empty."
//     );
//     println!("[pagination] Success. No cursor when keys <= page limit");

//     b.set("key-1001", "val-1001".as_bytes())
//         .map_err(err("pagination:set"))?;

//     let key_response = b.list_keys(None).map_err(err("pagination:list_keys"))?;
//     assert_eq!(
//         key_response.keys.len(),
//         1000,
//         "[pagination] Failure. Expected 1000 keys, only got {}",
//         key_response.keys.len()
//     );
//     assert!(
//         key_response.cursor.is_some(),
//         "[pagination] Failure. Cursor expected to be non-empty."
//     );
//     println!("[pagination] Success. With (pagelimit + 1) keys, get_many returns pageLimit with a cursor.");

//     let cursor = key_response.cursor.unwrap();
//     let key_response = b
//         .list_keys(Some(cursor))
//         .map_err(err("pagination:list_keys"))?;
//     assert_eq!(
//         key_response.keys.len(),
//         1,
//         "[pagination] Failure. Expected 1 key, got {}",
//         key_response.keys.len()
//     );
//     let kval = key_response.keys.first().unwrap().to_owned();
//     assert_eq!(
//         kval, "key-1001",
//         "[pagination] Failure. Wrong key returned. Expected \"key-1001\" but got {}",
//         kval
//     );
//     assert!(
//         key_response.cursor.is_none(),
//         "[pagination] Failure. Cursor expected to be empty."
//     );
//     let final_record_key = key_response.keys.first().unwrap().clone();
//     let final_record_val = b
//         .get(&final_record_key)
//         .map_err(err("pagination:get (final record)"))?;
//     assert!(
//         final_record_val.is_some(),
//         "[pagination] Failure. Final record empty.",
//     );
//     let final_record_val = String::from_utf8(final_record_val.unwrap()).unwrap();
//     assert_eq!(
//         final_record_val, "val-1001",
//         "[pagination] Failure. Final record expected to be \"val-1001\", but was {}",
//         final_record_val
//     );
//     println!("[pagination] Success. Query with cursor yields the final result.");

//     // Clean up all these keys
//     let keys: Vec<String> = key_values.iter().map(|(first, _)| first.clone()).collect();
//     Kv::batch::delete_many(b, &keys).map_err(err("pagination:cleanup"))?;
//     b.delete("key-1001").map_err(err("pagination:cleanup"))?;

//     Ok(())
// }
