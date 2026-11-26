use std::{
    marker::PhantomData,
    ops::{Bound, RangeBounds},
};

use custom_error::custom_error;

use psio::key::KeyPack;
use psio::pssz::{PsszPack, PsszUnpack};
use psio::Pssz;

use crate::{
    get_key_bytes, kv_get_bytes, kv_greater_equal_bytes, kv_less_than_bytes, kv_max_bytes,
    kv_put, kv_put_bytes, kv_remove, kv_remove_bytes, AccountNumber, DbId, KvHandle,
    KvMode, RawKey,
};

custom_error! {
    #[allow(clippy::enum_variant_names)] pub Error

    DuplicatedKey       = "Duplicated secondary key",
}

/// Whether a table of `service` in `db` is the running service's own.
///
/// What makes a row there "written by this service":
/// - The node opens a database only for a privileged service
///   (`NativeFunctions::kvOpen`); every other service gets its handle from
///   the `db` service (`Db::open`: service and write-only databases) or
///   `x-db` (`XDb::open`: subjective, session, temporary), and both give a
///   write handle only under the caller's own account.
/// - A privileged service can open any prefix itself. It is part of what
///   the chain trusts (it may replace any service's code), so it is not a
///   writer this rule defends against.
/// - A service may hand a write handle of its own prefix to another service
///   (exported handles): that is its own decision about its own rows.
/// - Nothing but services writes these databases: genesis writes native
///   rows only, and a snapshot carries the service database under a signed
///   state root.
/// - A privileged service can write under any account. It is part of what
///   the chain trusts: when it does, it is responsible for writing valid
///   rows, and the reading service does not defend against it.
///
/// A native database is never "own"; neither is anything when there is no
/// running service (a test, a tool: `get_service()` is 0). Trusted is not
/// unchecked: `psio::from_pssz_trusted` is safe Rust and panics on bytes
/// that are not a frame of the type (a row left by an incompatible change
/// of the record), which ends the action.
pub(crate) fn is_own_table(db: DbId, service: AccountNumber) -> bool {
    matches!(
        db,
        DbId::Service | DbId::WriteOnly | DbId::Subjective | DbId::Session | DbId::Temporary
    ) && service.value != 0
        && service == crate::get_service()
}

/// The one place a table row is decoded.
///
/// A row of the running service's own table (`own`) is bytes this service
/// wrote: it is read trusted (`psio::from_pssz_trusted`), which holds
/// nothing against what `Record` declares, so a row written by the fast
/// write (`psio::to_pssz`, which checks no bound or invariant) is read back
/// as it was written. A row of any other table (another service's, a native
/// table, a table opened from a handle or a prefix, any table read outside
/// a service) is validated (`psio::from_pssz`).
pub(crate) fn decode_row<Record: TableRecord>(own: bool, bytes: &[u8]) -> Record {
    if own {
        psio::from_pssz_trusted::<Record>(bytes)
    } else {
        psio::from_pssz::<Record>(bytes).unwrap()
    }
}

pub trait TableRecord: PsszPack<Pssz> + PsszUnpack<Pssz> {
    type PrimaryKey: KeyPack;
    const SECONDARY_KEYS: u8;
    const DB: DbId = DbId::Service;

    fn get_primary_key(&self) -> RawKey;

    /// Return the list of secondary keys.
    ///
    /// Implementer needs to make sure that it's ordered by the
    /// secondary key index. Otherwise it can have negative side effects
    /// when handling the secondary indexes writing and/or replacement.
    fn get_secondary_keys(&self) -> Vec<RawKey> {
        Vec::new()
    }
}

pub trait Table<Record: TableRecord>: Sized {
    const TABLE_INDEX: u16;
    const SERVICE: AccountNumber;

    /// A table on `handle`. `own` states that the rows under the handle
    /// are the running service's own (it wrote them): they are then read
    /// trusted.
    fn from_handle_owned(handle: KvHandle, own: bool) -> Self;
    fn prefix(&self) -> &[u8];
    fn handle(&self) -> &KvHandle;
    /// Whether the rows of this table are read trusted
    /// ([Table::from_handle_owned])
    fn is_own(&self) -> bool;

    /// A table on a handle whose owner is not known: its rows are
    /// validated when they are read.
    fn from_handle(handle: KvHandle) -> Self {
        Self::from_handle_owned(handle, false)
    }

    fn with_prefix(db_id: DbId, prefix: Vec<u8>, mode: KvMode) -> Self {
        Self::from_handle(KvHandle::new(db_id, &prefix, mode))
    }

    fn new() -> Self {
        Self::read_write()
    }

    fn read() -> Self {
        Self::with_mode(KvMode::Read)
    }

    fn read_write() -> Self {
        Self::with_mode(KvMode::ReadWrite)
    }

    fn with_mode(mode: KvMode) -> Self {
        Self::with_service_mode(Self::SERVICE, mode)
    }

    fn with_service(service: AccountNumber) -> Self {
        Self::with_service_mode(service, KvMode::Read)
    }

    fn with_service_mode(service: AccountNumber, mode: KvMode) -> Self {
        let db = <Record as TableRecord>::DB;
        let prefix = psio::to_key(&(service, Self::TABLE_INDEX));
        Self::from_handle_owned(KvHandle::new(db, &prefix, mode), is_own_table(db, service))
    }

    /// Returns one of the table indexes: 0 = Primary Key Index, else secondary indexes
    fn get_index<Key: KeyPack>(&self, idx: u8) -> TableIndex<Key, Record> {
        let mut idx_prefix = self.prefix().to_owned();
        idx_prefix.extend_from_slice(&psio::to_key(&idx));

        TableIndex::new(self.handle(), idx_prefix, idx > 0, self.is_own())
    }

    /// Returns the Primary Key Index
    fn get_index_pk(&self) -> TableIndex<Record::PrimaryKey, Record> {
        self.get_index::<Record::PrimaryKey>(0)
    }

    /// Put a value in the table
    fn put(&self, value: &Record) -> Result<(), Error> {
        let pk = self.serialize_key(0, &value.get_primary_key());
        self.handle_secondary_keys_put(&psio::to_key(&pk), value)?;
        kv_put(self.handle(), &pk, value);
        Ok(())
    }

    /// Removes a value from the table
    fn remove(&self, value: &Record) {
        let pk = self.serialize_key(0, &value.get_primary_key());
        kv_remove(self.handle(), &pk);
        self.handle_secondary_keys_removal(value);
    }

    /// Removes a key from the table
    ///
    /// The key must be the primary key. If object has secondary keys, this is
    /// equivalent to looking an object up by the key, then calling [remove] if found.
    fn erase(&self, key: &impl KeyPack) {
        if Record::SECONDARY_KEYS > 0 {
            if let Some(record) = self.get_index(0).get(key) {
                self.remove(&record);
            }
        } else {
            let pk = self.serialize_key(0, key);
            kv_remove(self.handle(), &pk);
        }
    }

    fn serialize_key<K: KeyPack>(&self, idx: u8, key: &K) -> RawKey {
        let mut data = self.prefix().to_owned();
        data.extend_from_slice(&psio::to_key(&idx));
        data.extend_from_slice(&psio::to_key(key));
        RawKey::new(data)
    }

    fn handle_secondary_keys_put(&self, pk: &[u8], value: &Record) -> Result<(), Error> {
        if Record::SECONDARY_KEYS < 1 {
            return Ok(());
        }

        let secondary_keys = value.get_secondary_keys();

        let old_record: Option<Record> = kv_get_bytes(self.handle(), pk).map(|row| decode_row(self.is_own(), &row));

        if let Some(old_record) = old_record {
            self.replace_secondary_keys(pk, &secondary_keys, old_record)
        } else {
            self.write_secondary_keys(pk, &secondary_keys)
        }
    }

    fn handle_secondary_keys_removal(&self, value: &Record) {
        if Record::SECONDARY_KEYS < 1 {
            return;
        }
        let secondary_keys = value.get_secondary_keys();
        let keys = self.make_secondary_keys_bytes_list(&secondary_keys);
        self.remove_keys_bytes(&keys);
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
        key.extend_from_slice(&psio::to_key(&key_idx));
        key.extend_from_slice(&psio::to_key(raw_key));
        key
    }

    /// Check if any key already exists in the DB
    fn check_unique_keys<T: AsRef<[u8]>>(&self, keys: &[T]) -> Result<(), Error> {
        for key in keys {
            if kv_get_bytes(self.handle(), key.as_ref()).is_some() {
                return Err(Error::DuplicatedKey);
            }
        }
        Ok(())
    }

    fn put_keys_bytes(&self, keys: &Vec<Vec<u8>>, pk: &[u8]) {
        for key in keys {
            kv_put_bytes(self.handle(), key, pk);
        }
    }

    fn remove_keys_bytes(&self, keys: &Vec<Vec<u8>>) {
        for key in keys {
            kv_remove_bytes(self.handle(), key);
        }
    }
}

pub trait ServiceTablesWrapper {
    const SERVICE: AccountNumber;
}

pub struct SingletonKey {}

impl KeyPack for SingletonKey {
    fn key_size(&self) -> usize {
        0
    }
    fn key_pack(&self, _out: &mut Vec<u8>) {}
}

pub struct TableIndex<Key: KeyPack, Record: TableRecord> {
    pub db: KvHandle,
    pub prefix: Vec<u8>,
    pub is_secondary: bool,
    /// The rows are the running service's own and are read trusted
    /// ([Table::is_own])
    pub own: bool,
    pub key_type: PhantomData<Key>,
    pub record_type: PhantomData<Record>,
}

impl<Key: KeyPack, Record: TableRecord> TableIndex<Key, Record> {
    /// Instantiate a new Table Index (Primary or Secondary)
    pub fn new(
        db: &KvHandle,
        prefix: Vec<u8>,
        is_secondary: bool,
        own: bool,
    ) -> TableIndex<Key, Record> {
        TableIndex {
            db: db.subtree(&[], KvMode::Read),
            prefix,
            is_secondary,
            own,
            key_type: PhantomData,
            record_type: PhantomData,
        }
    }

    /// Get the table record for the given key, if any
    pub fn get(&self, key: &Key) -> Option<Record> {
        let mut key_bytes = self.prefix.clone();
        key_bytes.extend_from_slice(&psio::to_key(key));

        kv_get_bytes(&self.db, &key_bytes).and_then(|v| self.get_value_from_bytes(v))
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
                // println!("included fc");
                front_key.extend_from_slice(&psio::to_key(k));
                Some(front_key)
            }
            Bound::Excluded(k) => {
                // println!("excluded fc");
                front_key.extend_from_slice(&psio::to_key(k));
                front_key.push(0);
                Some(front_key)
            }
            Bound::Unbounded => None,
        }
        .map(RawKey::new);
        // if front_key.is_some() {
        //  println!("range2 fc: {}", &front_key.as_ref().unwrap().data[..]);
        // }

        let mut back_key = self.prefix.clone();
        let back_key = match range.end_bound() {
            Bound::Included(k) => {
                // println!("excluded bc");
                back_key.extend_from_slice(&psio::to_key(k));
                back_key.push(0);
                Some(back_key)
            }
            Bound::Excluded(k) => {
                // println!("excluded bc");
                back_key.extend_from_slice(&psio::to_key(k));
                Some(back_key)
            }
            Bound::Unbounded => None,
        }
        .map(RawKey::new);
        // if back_key.is_some() {
        //     println!("range2 bc: {}", &back_key.as_ref().unwrap().data[..]);
        // }

        TableIter {
            table_index: self,
            front_key,
            back_key,
            is_end: false,
        }
    }

    fn get_value_from_bytes(&self, bytes: Vec<u8>) -> Option<Record> {
        if self.is_secondary {
            kv_get_bytes(&self.db, &bytes).map(|row| decode_row(self.own, &row))
        } else {
            Some(decode_row(self.own, &bytes))
        }
    }
}

impl<'a, Key: KeyPack, Record: TableRecord> IntoIterator for &'a TableIndex<Key, Record> {
    type Item = Record;
    type IntoIter = TableIter<'a, Key, Record>;

    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

pub struct TableIter<'a, Key: KeyPack, Record: TableRecord> {
    table_index: &'a TableIndex<Key, Record>,
    front_key: Option<RawKey>,
    back_key: Option<RawKey>,
    is_end: bool,
}

impl<'a, Key: KeyPack, Record: TableRecord> Iterator for TableIter<'a, Key, Record> {
    type Item = Record;

    fn next(&mut self) -> Option<Self::Item> {
        if self.is_end {
            return None;
        }

        // println!(">>> iterating from the front with key {:?}", self.front_key);

        let key = self
            .front_key
            .as_ref()
            .map_or(&self.table_index.prefix[..], |k| &k.data[..]);
        let value = kv_greater_equal_bytes(
            &self.table_index.db,
            key,
            self.table_index.prefix.len() as u32,
        );

        if let Some(value) = value {
            self.front_key = Some(RawKey::new(get_key_bytes()));

            if self.back_key.is_some() && self.front_key >= self.back_key {
                // println!(">>> front cursor met back cursor, it's the end");
                self.is_end = true;
                return None;
            }

            // prepare the front key for the next iteration
            self.front_key.as_mut().unwrap().data.push(0);

            // println!(">>> iterated and got key {:?}", self.front_key);

            self.table_index.get_value_from_bytes(value)
        } else {
            // println!(">>> setting end of iterator!");
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

impl<'a, Key: KeyPack, Record: TableRecord> DoubleEndedIterator for TableIter<'a, Key, Record> {
    fn next_back(&mut self) -> Option<Self::Item> {
        if self.is_end {
            return None;
        }

        let value = if let Some(back_key) = &self.back_key {
            kv_less_than_bytes(
                &self.table_index.db,
                &back_key.data[..],
                self.table_index.prefix.len() as u32,
            )
        } else {
            kv_max_bytes(&self.table_index.db, &self.table_index.prefix)
        };

        if let Some(value) = value {
            self.back_key = Some(RawKey::new(get_key_bytes()));

            // if self.front_key.is_some() {
            //     println!(
            //         "iterated from the back bc: {} fc: {}",
            //         &self.back_key.as_ref().unwrap().data[..],
            //         &self.front_key.as_ref().unwrap().data[..]
            //     );
            // } else {
            //     println!(
            //         "iterated from the back bc: {} NO FC",
            //         &self.back_key.as_ref().unwrap().data[..]
            //     );
            // }

            if self.back_key <= self.front_key {
                // println!(">>> back cursor met front cursor, it's the end");
                self.is_end = true;
                return None;
            }
            self.table_index.get_value_from_bytes(value)
        } else {
            // println!(">>> setting end of iterator!");
            self.is_end = true;
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Memo;

    #[derive(Debug, psio::PsszPack, psio::PsszUnpack)]
    struct Note {
        id: u32,
        memo: Memo,
    }
    impl TableRecord for Note {
        type PrimaryKey = u32;
        const SECONDARY_KEYS: u8 = 0;
        fn get_primary_key(&self) -> RawKey {
            RawKey::new(psio::to_key(&self.id))
        }
    }

    // A row whose memo is 81 bytes. No `Memo` is that long: these are the
    // bytes of the row with the longest memo and one more byte of text (the
    // memo is the last member, so it ends where the row ends).
    fn over_bound_row() -> Vec<u8> {
        let mut row = psio::to_pssz(&Note {
            id: 1,
            memo: Memo::new("a".repeat(80)).unwrap(),
        });
        row.push(b'a');
        row
    }

    /// Outside a service nothing is the running service's own table: a
    /// row is validated, and a memo of 81 bytes is refused.
    #[test]
    #[should_panic]
    fn a_row_of_a_table_that_is_not_the_services_own_is_validated() {
        let _: Note = decode_row(false, &over_bound_row());
    }

    /// The service's own table: the trusted read gives back the row as it
    /// was written, bound or no bound.
    #[test]
    fn the_trusted_read_does_not_hold_a_row_against_its_declaration() {
        let row = over_bound_row();
        assert!(psio::from_pssz::<Note>(&row).is_err());
        let note: Note = decode_row(true, &row);
        assert_eq!(note.id, 1);
        assert_eq!(note.memo.to_string().len(), 81);
        // No service is running here: no table is its own.
        let alice = AccountNumber::from_exact("alice").unwrap();
        assert!(!is_own_table(DbId::Service, alice));
        assert!(!is_own_table(DbId::Service, crate::get_service()));
        // A native table is never a service's own.
        assert!(!is_own_table(DbId::Native, alice));
    }
}
