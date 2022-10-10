use std::marker::PhantomData;

use fracpack::PackableOwned;

use crate::{kv_get, kv_max, kv_put, AccountNumber, DbId, KeyView, ToKey};

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
            prefix: prefix,
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
        let mut table_prefix = self.prefix.clone();
        idx.append_key(&mut table_prefix);

        TableIndex {
            db_id: self.db_id.to_owned(),
            prefix: table_prefix,
            idx,
            key_type: PhantomData,
            record_type: PhantomData,
        }
    }

    pub fn serialize_key<K: ToKey>(&self, idx: u8, key: &K) -> impl ToKey {
        let mut data = self.prefix.clone();
        idx.append_key(&mut data);
        key.append_key(&mut data);
        KeyView { data }
    }

    pub fn put(&self, value: &Record) {
        let pk = self.serialize_key(0, &value.get_primary_key());
        // todo: handle secondaries
        kv_put(self.db_id.to_owned(), &pk, value);
    }
}

pub struct TableIndex<Key: ToKey, Record: TableRecord> {
    pub db_id: DbId,
    pub prefix: Vec<u8>,
    pub idx: u8,
    pub key_type: PhantomData<Key>,
    pub record_type: PhantomData<Record>,
}

impl<Key: ToKey, Record: TableRecord> TableIndex<Key, Record> {
    pub fn get(&self, key: Key) -> Option<Record> {
        let mut data = self.prefix.clone();
        key.append_key(&mut data);
        let key = KeyView { data };

        kv_get(self.db_id.to_owned(), &key).unwrap()
    }

    pub fn last(&self) -> Option<Record> {
        let key = KeyView {
            data: self.prefix.clone(),
        };

        kv_max(self.db_id.to_owned(), &key)
    }
}
