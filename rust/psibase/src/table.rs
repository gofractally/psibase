// pub struct Table {
//     prefix: Vec<u8>,
// }

use std::marker::PhantomData;

use fracpack::PackableOwned;

use crate::{kv_max, kv_put, AccountNumber, DbId, ToKey};

pub trait TableRecord: PackableOwned {
    fn get_primary_key(&self) -> Vec<u8>;
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
        table_prefix.push(idx);
        TableIndex {
            db_id: self.db_id.to_owned(),
            prefix: table_prefix,
            is_secondary: idx > 0,
            key_type: PhantomData,
            record_type: PhantomData,
        }
    }

    pub fn serialize_key<K: ToKey>(&self, idx: u8, key: &K) -> Vec<u8> {
        (self.prefix.clone(), idx, key).to_key() // TODO: test
    }

    pub fn put(&self, value: &Record) {
        let pk = self.serialize_key(0, &value.get_primary_key());
        println!(">>> putting pk {:?}", pk);
        // todo: handle secondaries
        kv_put(self.db_id.to_owned(), &pk, value); // TODO: this is crashing in the tester
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
    pub fn get(&self, key: Key) -> Option<Record> {
        None
    }

    pub fn last(&self) -> Option<Record> {
        kv_max(self.db_id.to_owned(), &self.prefix)
    }
}

// impl<Record: TableRecord> Iterator for TableIndex<Record> {
//     type Item = Record;

//     fn next(&mut self) -> Option<Self::Item> {
//         // let current = self.curr;

//         // self.curr = self.next;

//         // Since there's no endpoint to a Fibonacci sequence, the `Iterator`
//         // will never return `None`, and `Some` is always returned.
//         // Some(current)
//         None
//     }
// }
