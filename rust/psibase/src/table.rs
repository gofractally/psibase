use std::marker::PhantomData;

use fracpack::PackableOwned;

use crate::{
    get_key_bytes, kv_get, kv_greater_equal_bytes, kv_insert_unique_bytes, kv_less_than_bytes,
    kv_max_bytes, kv_put, kv_remove, AccountNumber, DbId, KeyView, RawKey, ToKey,
};

// TODO: remove helper
fn to_hex(bytes: &[u8]) -> String {
    let mut result: Vec<u8> = Vec::with_capacity(bytes.len() * 2);
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    for byte in bytes {
        result.push(DIGITS[(byte >> 4) as usize]);
        result.push(DIGITS[(byte & 0x0f) as usize]);
    }
    String::from_utf8(result).unwrap()
}

pub trait TableRecord: PackableOwned {
    type PrimaryKey: ToKey;

    fn get_primary_key(&self) -> Self::PrimaryKey;

    fn get_secondary_keys(&self) -> Vec<RawKey> {
        Vec::new()
    }
}

pub trait TableRecordWithSecondaryKey: TableRecord {
    type SecondaryKey: ToKey;

    fn get_secondary_key(&self) -> Self::SecondaryKey;
}

pub trait TableHandler<Record: TableRecord> {
    const TABLE_INDEX: u16;
    const TABLE_SERVICE: AccountNumber;

    fn open() -> Table<Record> {
        let prefix = (Self::TABLE_SERVICE, Self::TABLE_INDEX).to_key();
        Table {
            db_id: DbId::Service,
            prefix,
            phantom: PhantomData,
        }
    }
}

pub struct Table<Record: TableRecord> {
    db_id: DbId,
    prefix: Vec<u8>,
    phantom: PhantomData<Record>,
}

impl<Record: TableRecord> Table<Record> {
    /// Returns one of the table indexes: 0 = Primary Key Index, else secondary indexes
    pub fn get_index<Key: ToKey>(&self, idx: u8) -> TableIndex<Key, Record> {
        let mut idx_prefix = self.prefix.clone();
        idx.append_key(&mut idx_prefix);

        TableIndex::new(self.db_id, idx_prefix, idx > 0)
    }

    /// Returns the Primary Key Index
    pub fn get_index_pk(&self) -> TableIndex<Record::PrimaryKey, Record> {
        self.get_index::<Record::PrimaryKey>(0)
    }

    pub fn serialize_key<K: ToKey>(&self, idx: u8, key: &K) -> impl ToKey {
        let mut data = self.prefix.clone();
        idx.append_key(&mut data);
        key.append_key(&mut data);
        RawKey::new(data)
    }

    pub fn put(&self, value: &Record) {
        let pk = self.serialize_key(0, &value.get_primary_key());
        self.handle_put_secondary_keys(&pk.to_key(), value);
        kv_put(self.db_id, &pk, value);
    }

    pub fn handle_put_secondary_keys(&self, pk: &[u8], value: &Record) {
        let secondary_keys = value.get_secondary_keys();

        if secondary_keys.is_empty() {
            return;
        }

        let old_record: Option<Record> = kv_get(self.db_id, &KeyView::new(pk)).unwrap();

        if let Some(old_record) = old_record {
            self.replace_secondary_keys(pk, &secondary_keys, old_record);
        } else {
            self.write_secondary_keys(pk, &secondary_keys);
        }
    }

    pub fn replace_secondary_keys(&self, pk: &[u8], secondary_keys: &[RawKey], old_record: Record) {
        let mut key_buffer = self.prefix.clone();
        let mut idx: u8 = 1; // Secondary keys starts at position 1 (Pk is 0)

        let old_keys = old_record.get_secondary_keys();

        for (new_key, old_key) in secondary_keys.iter().zip(&old_keys) {
            if old_key != new_key {
                println!(
                    ">>> replacing secondary key idx: {} // old: {} // new: {} // pk: {}",
                    idx,
                    to_hex(&old_key.data[..]),
                    to_hex(&new_key.data[..]),
                    to_hex(pk)
                );

                idx.append_key(&mut key_buffer);

                old_key.append_key(&mut key_buffer);
                kv_remove(self.db_id, &KeyView::new(&key_buffer));
                key_buffer.truncate(self.prefix.len() + 1);

                new_key.append_key(&mut key_buffer);
                kv_insert_unique_bytes(self.db_id, &KeyView::new(&key_buffer), pk);
                key_buffer.truncate(self.prefix.len());
            }

            idx += 1;
        }
    }

    pub fn write_secondary_keys(&self, pk: &[u8], secondary_keys: &Vec<RawKey>) {
        let mut key_buffer = self.prefix.clone();
        let mut idx: u8 = 1; // Secondary keys starts at position 1 (Pk is 0)
        for raw_key in secondary_keys {
            idx.append_key(&mut key_buffer);
            raw_key.append_key(&mut key_buffer);

            println!(
                ">>> inserting secondary key {} // {} // {}",
                idx,
                to_hex(&key_buffer[..]),
                to_hex(pk)
            );
            kv_insert_unique_bytes(self.db_id, &KeyView::new(&key_buffer), pk);

            key_buffer.truncate(self.prefix.len());
            idx += 1;
        }
    }

    pub fn remove(&self, primary_key: &impl ToKey) {
        let pk = self.serialize_key(0, primary_key);
        // todo: handle secondaries
        kv_remove(self.db_id, &pk);
    }
}

pub struct TableIndex<Key: ToKey, Record: TableRecord> {
    pub db_id: DbId,
    pub prefix: Vec<u8>,
    front_key: RawKey,
    back_key: RawKey,
    is_secondary: bool,
    is_end: bool,
    pub key_type: PhantomData<Key>,
    pub record_type: PhantomData<Record>,
}

impl<Key: ToKey, Record: TableRecord> TableIndex<Key, Record> {
    /// Instantiate a new Table Index (Primary or Secondary)
    fn new(db_id: DbId, prefix: Vec<u8>, is_secondary: bool) -> TableIndex<Key, Record> {
        TableIndex {
            db_id,
            front_key: RawKey::new(prefix.clone()),
            back_key: RawKey::new(prefix.clone()),
            prefix,
            is_secondary,
            is_end: false,
            key_type: PhantomData,
            record_type: PhantomData,
        }
    }

    /// Get the table record for the given key, if any
    ///
    /// It does not affect the iterator
    pub fn get(&self, key: Key) -> Option<Record> {
        let mut data = self.prefix.clone();
        key.append_key(&mut data);
        let key = RawKey::new(data);

        kv_get(self.db_id, &key).unwrap()
    }

    /// Set the range of available records for the iterator; useful for viewing a slice of the records
    ///
    /// - `from` is inclusive, `to` is not: [from..to)
    /// - using this after the start of an iteration process (for..loops, next(), next_back() etc)
    /// can mess the iteration sequence order, since it resets the front and the back cursors
    pub fn range(&mut self, from: Key, to: Key) -> &mut Self {
        let mut front_key = self.prefix.clone();
        from.append_key(&mut front_key);
        self.front_key = RawKey::new(front_key);

        let mut back_key = self.prefix.clone();
        to.append_key(&mut back_key);
        self.back_key = RawKey::new(back_key);

        self
    }

    fn get_value_from_pk_bytes(&self, bytes: Vec<u8>) -> Option<Record> {
        if self.is_secondary {
            kv_get(self.db_id, &RawKey::new(bytes)).unwrap()
        } else {
            Some(Record::unpack(&bytes[..], &mut 0).unwrap())
        }
    }
}

impl<Key: ToKey, Record: TableRecord> Iterator for TableIndex<Key, Record> {
    type Item = Record;

    fn next(&mut self) -> Option<Self::Item> {
        if self.is_end {
            return None;
        }

        println!(">>> iterating from the front with key {:?}", self.front_key);

        let value = kv_greater_equal_bytes(
            self.db_id,
            &self.front_key.data[..],
            self.prefix.len() as u32,
        );

        if let Some(value) = value {
            self.front_key = RawKey::new(get_key_bytes());

            if self.front_key >= self.back_key {
                println!(">>> front cursor met back cursor, it's the end");
                self.is_end = true;
                return None;
            }

            // prepare the front key for the next iteration
            self.front_key.data.push(0);

            println!(">>> iterated and got key {:?}", self.front_key);

            self.get_value_from_pk_bytes(value)
        } else {
            println!(">>> setting end of iterator!");
            self.is_end = true;
            None
        }
    }
}

impl<Key: ToKey, Record: TableRecord> DoubleEndedIterator for TableIndex<Key, Record> {
    fn next_back(&mut self) -> Option<Self::Item> {
        if self.is_end {
            return None;
        }

        println!(
            ">>> iterating from the back with key {:?}",
            to_hex(&self.back_key.data[..])
        );

        let value = if self.back_key.data == self.prefix {
            kv_max_bytes(self.db_id, &self.back_key.data[..])
        } else {
            kv_less_than_bytes(
                self.db_id,
                &self.back_key.data[..],
                self.prefix.len() as u32,
            )
        };

        if let Some(value) = value {
            self.back_key = RawKey::new(get_key_bytes());

            if self.back_key <= self.front_key {
                println!(">>> back cursor met front cursor, it's the end");
                self.is_end = true;
                return None;
            }

            println!(
                ">>> back-iterated and got key {:?}",
                to_hex(&self.back_key.data[..])
            );

            self.get_value_from_pk_bytes(value)
        } else {
            println!(">>> setting end of iterator!");
            self.is_end = true;
            None
        }
    }
}
