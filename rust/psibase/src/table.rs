use std::{
    marker::PhantomData,
    ops::{Bound, RangeBounds},
};

use custom_error::custom_error;

use fracpack::PackableOwned;

use crate::{
    get_key_bytes, kv_get, kv_get_bytes, kv_greater_equal_bytes, kv_less_than_bytes, kv_max_bytes,
    kv_put, kv_put_bytes, kv_remove, kv_remove_bytes, AccountNumber, DbId, KeyView, RawKey, ToKey,
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

custom_error! {
    #[allow(clippy::enum_variant_names)] pub Error

    DuplicatedKey       = "Duplicated secondary key",
}

pub trait TableRecord: PackableOwned {
    type PrimaryKey: ToKey;

    fn get_primary_key(&self) -> Self::PrimaryKey;

    /// Return the list of secondary keys.
    ///
    /// Implementer needs to make sure that it's ordered by the
    /// secondary key index. Otherwise it can have negative side effects
    /// when handling the secondary indexes writing and/or replacement.
    fn get_secondary_keys(&self) -> Vec<RawKey> {
        Vec::new()
    }
}

pub trait TableBase {
    fn prefix(&self) -> &[u8];
    fn db_id(&self) -> DbId;
}

pub trait TableHandler: Sized {
    const TABLE_INDEX: u16;
    const TABLE_SERVICE: AccountNumber;

    fn new(db_id: DbId, prefix: Vec<u8>) -> Self;

    fn open() -> Self {
        let prefix = (Self::TABLE_SERVICE, Self::TABLE_INDEX).to_key();
        Self::create_table_from_prefix(prefix)
    }

    fn open_custom(service: AccountNumber, table_index: u16) -> Self {
        let prefix = (service, table_index).to_key();
        Self::create_table_from_prefix(prefix)
    }

    fn create_table_from_prefix(prefix: Vec<u8>) -> Self {
        Self::new(DbId::Service, prefix)
    }
}

pub trait TableWrapper<Record: TableRecord>: TableBase {
    /// Returns one of the table indexes: 0 = Primary Key Index, else secondary indexes
    fn get_index<Key: ToKey>(&self, idx: u8) -> TableIndex<Key, Record> {
        let mut idx_prefix = self.prefix().to_owned();
        idx.append_key(&mut idx_prefix);

        TableIndex::new(self.db_id(), idx_prefix, idx > 0)
    }

    /// Returns the Primary Key Index
    fn get_index_pk(&self) -> TableIndex<Record::PrimaryKey, Record> {
        self.get_index::<Record::PrimaryKey>(0)
    }

    /// Put a value in the table
    fn put(&self, value: &Record) -> Result<(), Error> {
        let pk = self.serialize_key(0, &value.get_primary_key());
        self.handle_secondary_keys_put(&pk.to_key(), value)?;
        kv_put(self.db_id(), &pk, value);
        Ok(())
    }

    /// Removes a value from the table
    fn remove(&self, value: &Record) {
        let pk = self.serialize_key(0, &value.get_primary_key());
        kv_remove(self.db_id(), &pk);
        self.handle_secondary_keys_removal(value);
    }

    fn serialize_key<K: ToKey>(&self, idx: u8, key: &K) -> RawKey {
        let mut data = self.prefix().to_owned();
        idx.append_key(&mut data);
        key.append_key(&mut data);
        RawKey::new(data)
    }

    fn handle_secondary_keys_put(&self, pk: &[u8], value: &Record) -> Result<(), Error> {
        let secondary_keys = value.get_secondary_keys();

        let old_record: Option<Record> = kv_get(self.db_id(), &KeyView::new(pk)).unwrap();

        if let Some(old_record) = old_record {
            self.replace_secondary_keys(pk, &secondary_keys, old_record)
        } else {
            self.write_secondary_keys(pk, &secondary_keys)
        }
    }

    fn write_secondary_keys(&self, pk: &[u8], secondary_keys: &[RawKey]) -> Result<(), Error> {
        let keys = self.make_secondary_keys_bytes_list(secondary_keys);
        self.check_unique_keys(&keys[..])?;
        self.put_keys_bytes(&keys, pk);
        Ok(())
    }

    fn replace_secondary_keys(
        &self,
        pk: &[u8],
        secondary_keys: &[RawKey],
        old_record: Record,
    ) -> Result<(), Error> {
        let new_keys = self.make_secondary_keys_bytes_list(secondary_keys);

        let old_raw_keys = old_record.get_secondary_keys();
        let old_keys = self.make_secondary_keys_bytes_list(&old_raw_keys);

        let non_existing_new_keys: Vec<&Vec<u8>> = new_keys
            .iter()
            .enumerate()
            .filter(|(i, new_key)| *i >= old_keys.len() || old_keys[*i] != **new_key)
            .map(|(_, k)| k)
            .collect();

        self.check_unique_keys(&non_existing_new_keys[..])?;
        self.remove_keys_bytes(&old_keys);
        self.put_keys_bytes(&new_keys, pk);

        Ok(())
    }

    fn make_secondary_keys_bytes_list(&self, raw_keys: &[RawKey]) -> Vec<Vec<u8>> {
        let keys: Vec<Vec<u8>> = raw_keys
            .iter()
            .enumerate()
            .map(|(idx, raw_key)| {
                // Secondary keys starts at position 1 (Pk is 0)
                self.make_prefixed_key_bytes(idx as u8 + 1, raw_key)
            })
            .collect();
        keys
    }

    fn make_prefixed_key_bytes(&self, key_idx: u8, raw_key: &RawKey) -> Vec<u8> {
        let mut key = self.prefix().to_owned();
        key_idx.append_key(&mut key);
        raw_key.append_key(&mut key);
        key
    }

    /// Check if any key already exists in the DB
    fn check_unique_keys<T: AsRef<[u8]>>(&self, keys: &[T]) -> Result<(), Error> {
        for key in keys {
            if kv_get_bytes(self.db_id(), key.as_ref()).is_some() {
                return Err(Error::DuplicatedKey);
            }
        }
        Ok(())
    }

    fn handle_secondary_keys_removal(&self, value: &Record) {
        let secondary_keys = value.get_secondary_keys();
        let keys = self.make_secondary_keys_bytes_list(&secondary_keys);
        self.remove_keys_bytes(&keys);
    }

    fn put_keys_bytes(&self, keys: &Vec<Vec<u8>>, pk: &[u8]) {
        for key in keys {
            kv_put_bytes(self.db_id(), key, pk);
        }
    }

    fn remove_keys_bytes(&self, keys: &Vec<Vec<u8>>) {
        for key in keys {
            kv_remove_bytes(self.db_id(), key);
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
                back_key.push(0);
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
