use std::{
    marker::PhantomData,
    ops::{Bound, RangeBounds},
};

use fracpack::PackableOwned;

use crate::{
    get_key_bytes, kv_get, kv_get_bytes, kv_greater_equal_bytes, kv_insert_unique_bytes,
    kv_less_than_bytes, kv_max_bytes, kv_put, kv_remove, AccountNumber, DbId, KeyView, RawKey,
    ToKey,
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

pub struct Table {
    pub db_id: DbId,
    pub prefix: Vec<u8>,
}

pub trait TableBase {
    fn prefix(&self) -> Vec<u8>;
    fn db_id(&self) -> DbId;
}

pub trait TableHandler {
    type TableType;
    const TABLE_INDEX: u16;
    const TABLE_SERVICE: AccountNumber;

    fn new(table: Table) -> Self::TableType;

    fn open() -> Self::TableType {
        let prefix = (Self::TABLE_SERVICE, Self::TABLE_INDEX).to_key();
        Self::create_table_from_prefix(prefix)
    }

    fn open_custom(service: AccountNumber, table_index: u16) -> Self::TableType {
        let prefix = (service, table_index).to_key();
        Self::create_table_from_prefix(prefix)
    }

    fn create_table_from_prefix(prefix: Vec<u8>) -> Self::TableType {
        let table = Table {
            db_id: DbId::Service,
            prefix,
        };
        Self::new(table)
    }
}

pub trait TableWrapper<Record: TableRecord>: TableBase {
    /// Returns one of the table indexes: 0 = Primary Key Index, else secondary indexes
    fn get_index<Key: ToKey>(&self, idx: u8) -> TableIndex<Key, Record> {
        let mut idx_prefix = self.prefix();
        idx.append_key(&mut idx_prefix);

        TableIndex::new(self.db_id(), idx_prefix, idx > 0)
    }

    /// Returns the Primary Key Index
    fn get_index_pk(&self) -> TableIndex<Record::PrimaryKey, Record> {
        self.get_index::<Record::PrimaryKey>(0)
    }

    /// Put a value in the table
    fn put(&self, value: &Record) {
        let pk = self.serialize_key(0, &value.get_primary_key());
        self.handle_secondary_keys_put(&pk.to_key(), value);
        kv_put(self.db_id(), &pk, value);
    }

    /// Removes a value from the table
    fn remove(&self, value: &Record) {
        let pk = self.serialize_key(0, &value.get_primary_key());
        kv_remove(self.db_id(), &pk);
        self.handle_secondary_keys_removal(value);
    }

    fn serialize_key<K: ToKey>(&self, idx: u8, key: &K) -> RawKey {
        let mut data = self.prefix();
        idx.append_key(&mut data);
        key.append_key(&mut data);
        RawKey::new(data)
    }

    fn handle_secondary_keys_put(&self, pk: &[u8], value: &Record) {
        let secondary_keys = value.get_secondary_keys();
        if secondary_keys.is_empty() {
            return;
        }

        let old_record: Option<Record> = kv_get(self.db_id(), &KeyView::new(pk)).unwrap();

        if let Some(old_record) = old_record {
            self.replace_secondary_keys(pk, &secondary_keys, old_record);
        } else {
            self.write_secondary_keys(pk, &secondary_keys);
        }
    }

    fn replace_secondary_keys(&self, pk: &[u8], secondary_keys: &[RawKey], old_record: Record) {
        let mut key_buffer = self.prefix();
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
                kv_remove(self.db_id(), &KeyView::new(&key_buffer));
                key_buffer.truncate(self.prefix().len() + 1);

                new_key.append_key(&mut key_buffer);
                kv_insert_unique_bytes(self.db_id(), &KeyView::new(&key_buffer), pk);
                key_buffer.truncate(self.prefix().len());
            }

            idx += 1;
        }
    }

    fn write_secondary_keys(&self, pk: &[u8], secondary_keys: &Vec<RawKey>) {
        let mut key_buffer = self.prefix();
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
            kv_insert_unique_bytes(self.db_id(), &KeyView::new(&key_buffer), pk);

            key_buffer.truncate(self.prefix().len());
            idx += 1;
        }
    }

    fn handle_secondary_keys_removal(&self, value: &Record) {
        let secondary_keys = value.get_secondary_keys();
        if secondary_keys.is_empty() {
            return;
        }

        let mut key_buffer = self.prefix();
        let mut idx: u8 = 1; // Secondary keys starts at position 1 (Pk is 0)

        for raw_key in secondary_keys {
            idx.append_key(&mut key_buffer);
            raw_key.append_key(&mut key_buffer);

            println!(
                ">>> removing secondary key idx: {} // key: {}",
                idx,
                to_hex(&raw_key.data[..])
            );
            kv_remove(self.db_id(), &KeyView::new(&key_buffer));

            key_buffer.truncate(self.prefix().len());
            idx += 1;
        }
    }
}

pub struct TableIndex<Key: ToKey, Record: TableRecord> {
    pub db_id: DbId,
    pub prefix: Vec<u8>,
    pub is_secondary: bool,
    pub key_type: PhantomData<Key>,
    pub record_type: PhantomData<Record>,
}

impl<Key: ToKey, Record: TableRecord> TableIndex<Key, Record> {
    /// Instantiate a new Table Index (Primary or Secondary)
    fn new(db_id: DbId, prefix: Vec<u8>, is_secondary: bool) -> TableIndex<Key, Record> {
        TableIndex {
            db_id,
            prefix,
            is_secondary,
            key_type: PhantomData,
            record_type: PhantomData,
        }
    }

    /// Get the table record for the given key, if any
    pub fn get(&self, key: Key) -> Option<Record> {
        let mut key_bytes = self.prefix.clone();
        key.append_key(&mut key_bytes);

        kv_get_bytes(self.db_id, &key_bytes).and_then(|v| self.get_value_from_bytes(v))
    }

    /// Creates an iterator for visiting all the table key-values, in sorted order.
    pub fn iter(&self) -> TableIter<'_, Key, Record> {
        TableIter {
            table_index: self,
            front_key: None,
            back_key: None,
            is_end: false,
        }
    }

    /// Constructs a double-ended iterator over a sub-range of elements in the table.
    /// The simplest way is to use the range syntax `min..max`, thus `range(min..max)` will
    /// yield elements from min (inclusive) to max (exclusive).
    /// The range may also be entered as `(Bound<T>, Bound<T>)`, so for example
    /// `range((Excluded(4), Included(10)))` will yield a left-exclusive, right-inclusive
    /// range from 4 to 10.
    pub fn range(&self, range: impl RangeBounds<Key>) -> TableIter<'_, Key, Record> {
        let mut front_key = self.prefix.clone();
        let front_key = match range.start_bound() {
            Bound::Included(k) => {
                println!("included fc");
                k.append_key(&mut front_key);
                Some(front_key)
            }
            Bound::Excluded(k) => {
                println!("excluded fc");
                k.append_key(&mut front_key);
                front_key.push(0);
                Some(front_key)
            }
            Bound::Unbounded => None,
        }
        .map(RawKey::new);
        if front_key.is_some() {
            println!("range2 fc: {}", to_hex(&front_key.as_ref().unwrap().data));
        }

        let mut back_key = self.prefix.clone();
        let back_key = match range.end_bound() {
            Bound::Included(k) => {
                println!("excluded bc");
                k.append_key(&mut back_key);
                // since the kv_less_than is used, increment last byte to be included
                let mut last_byte = back_key.pop().unwrap();
                if last_byte == u8::MAX {
                    back_key.push(last_byte);
                    back_key.push(0);
                } else {
                    last_byte += 1;
                    back_key.push(last_byte);
                }
                Some(back_key)
            }
            Bound::Excluded(k) => {
                println!("excluded bc");
                k.append_key(&mut back_key);
                Some(back_key)
            }
            Bound::Unbounded => None,
        }
        .map(RawKey::new);
        if back_key.is_some() {
            println!("range2 bc: {}", to_hex(&back_key.as_ref().unwrap().data));
        }

        TableIter {
            table_index: self,
            front_key,
            back_key,
            is_end: false,
        }
    }

    fn get_value_from_bytes(&self, bytes: Vec<u8>) -> Option<Record> {
        if self.is_secondary {
            kv_get(self.db_id, &RawKey::new(bytes)).unwrap()
        } else {
            Some(Record::unpack(&bytes[..], &mut 0).unwrap())
        }
    }
}

impl<'a, Key: ToKey, Record: TableRecord> IntoIterator for &'a TableIndex<Key, Record> {
    type Item = Record;
    type IntoIter = TableIter<'a, Key, Record>;

    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

pub struct TableIter<'a, Key: ToKey, Record: TableRecord> {
    table_index: &'a TableIndex<Key, Record>,
    front_key: Option<RawKey>,
    back_key: Option<RawKey>,
    is_end: bool,
}

impl<'a, Key: ToKey, Record: TableRecord> Iterator for TableIter<'a, Key, Record> {
    type Item = Record;

    fn next(&mut self) -> Option<Self::Item> {
        if self.is_end {
            return None;
        }

        println!(">>> iterating from the front with key {:?}", self.front_key);

        let key = self
            .front_key
            .as_ref()
            .map_or(&self.table_index.prefix[..], |k| &k.data[..]);
        let value = kv_greater_equal_bytes(
            self.table_index.db_id,
            key,
            self.table_index.prefix.len() as u32,
        );

        if let Some(value) = value {
            self.front_key = Some(RawKey::new(get_key_bytes()));

            if self.back_key.is_some() && self.front_key >= self.back_key {
                println!(">>> front cursor met back cursor, it's the end");
                self.is_end = true;
                return None;
            }

            // prepare the front key for the next iteration
            self.front_key.as_mut().unwrap().data.push(0);

            println!(">>> iterated and got key {:?}", self.front_key);

            self.table_index.get_value_from_bytes(value)
        } else {
            println!(">>> setting end of iterator!");
            self.is_end = true;
            None
        }
    }

    fn last(mut self) -> Option<Self::Item> {
        self.next_back()
    }

    fn min(mut self) -> Option<Self::Item> {
        self.next()
    }

    fn max(mut self) -> Option<Self::Item> {
        self.next_back()
    }
}

impl<'a, Key: ToKey, Record: TableRecord> DoubleEndedIterator for TableIter<'a, Key, Record> {
    fn next_back(&mut self) -> Option<Self::Item> {
        if self.is_end {
            return None;
        }

        let value = if let Some(back_key) = &self.back_key {
            kv_less_than_bytes(
                self.table_index.db_id,
                &back_key.data[..],
                self.table_index.prefix.len() as u32,
            )
        } else {
            kv_max_bytes(self.table_index.db_id, &self.table_index.prefix)
        };

        if let Some(value) = value {
            self.back_key = Some(RawKey::new(get_key_bytes()));

            if self.front_key.is_some() {
                println!(
                    "iterated from the back bc: {} fc: {}",
                    to_hex(&self.back_key.as_ref().unwrap().data),
                    to_hex(&self.front_key.as_ref().unwrap().data)
                );
            } else {
                println!(
                    "iterated from the back bc: {} NO FC",
                    to_hex(&self.back_key.as_ref().unwrap().data)
                );
            }

            if self.back_key <= self.front_key {
                println!(">>> back cursor met front cursor, it's the end");
                self.is_end = true;
                return None;
            }
            self.table_index.get_value_from_bytes(value)
        } else {
            println!(">>> setting end of iterator!");
            self.is_end = true;
            None
        }
    }
}
