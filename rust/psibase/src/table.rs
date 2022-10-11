use std::marker::PhantomData;

use fracpack::PackableOwned;

use crate::{
    get_key_bytes, kv_get, kv_greater_equal, kv_less_than, kv_max, kv_put, kv_remove,
    AccountNumber, DbId, RawKey, ToKey,
};

pub trait TableRecord: PackableOwned {
    type PrimaryKey: ToKey;

    fn get_primary_key(&self) -> Self::PrimaryKey;
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

        TableIndex::new(self.db_id.to_owned(), idx_prefix)
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
        // todo: handle secondaries
        kv_put(self.db_id.to_owned(), &pk, value);
    }

    pub fn remove(&self, primary_key: &impl ToKey) {
        let pk = self.serialize_key(0, primary_key);
        // todo: handle secondaries
        kv_remove(self.db_id.to_owned(), &pk);
    }
}

pub struct TableIndex<Key: ToKey, Record: TableRecord> {
    pub db_id: DbId,
    pub prefix: Vec<u8>,
    front_key: RawKey,
    back_key: RawKey,
    is_end: bool,
    pub key_type: PhantomData<Key>,
    pub record_type: PhantomData<Record>,
}

impl<Key: ToKey, Record: TableRecord> TableIndex<Key, Record> {
    fn new(db_id: DbId, prefix: Vec<u8>) -> TableIndex<Key, Record> {
        TableIndex {
            db_id,
            front_key: RawKey::new(prefix.clone()),
            back_key: RawKey::new(prefix.clone()),
            prefix,
            is_end: false,
            key_type: PhantomData,
            record_type: PhantomData,
        }
    }

    pub fn get(&self, key: Key) -> Option<Record> {
        let mut data = self.prefix.clone();
        key.append_key(&mut data);
        let key = RawKey { data };

        kv_get(self.db_id.to_owned(), &key).unwrap()
    }

    pub fn lower_bound(&self, key: Key) -> Option<Record> {
        let mut data = self.prefix.clone();
        key.append_key(&mut data);
        let key = RawKey::new(data);

        kv_greater_equal(self.db_id.to_owned(), &key, self.prefix.len() as u32)
    }
}

impl<Key: ToKey, Record: TableRecord> Iterator for TableIndex<Key, Record> {
    type Item = Record;

    fn next(&mut self) -> Option<Self::Item> {
        if self.is_end {
            return None;
        }

        self.front_key.data.push(0);
        println!(">>> iterating from the front with key {:?}", self.front_key);

        let value: Option<Record> = kv_greater_equal(
            self.db_id.to_owned(),
            &self.front_key,
            self.prefix.len() as u32,
        );

        if value.is_some() {
            self.front_key = RawKey::new(get_key_bytes());

            if self.front_key == self.back_key {
                println!(">>> front cursor met back cursor, it's the end");
                self.is_end = true;
                return None;
            }

            println!(">>> iterated and got key {:?}", self.front_key);
            value
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

        println!(">>> iterating from the back with key {:?}", self.back_key);

        let value = if self.back_key.data == self.prefix {
            kv_max(self.db_id.to_owned(), &self.back_key)
        } else {
            kv_less_than(
                self.db_id.to_owned(),
                &self.back_key,
                self.prefix.len() as u32,
            )
        };

        if value.is_some() {
            self.back_key = RawKey::new(get_key_bytes());

            if self.back_key == self.front_key {
                println!(">>> back cursor met front cursor, it's the end");
                self.is_end = true;
                return None;
            }

            println!(">>> back-iterated and got key {:?}", self.back_key);
            value
        } else {
            println!(">>> setting end of iterator!");
            self.is_end = true;
            None
        }
    }
}
