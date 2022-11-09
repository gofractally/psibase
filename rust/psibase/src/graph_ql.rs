use crate::{
    get_key_bytes, kv_get, kv_greater_equal_bytes, kv_less_than_bytes, kv_max_bytes, RawKey,
    TableIndex, TableRecord, ToKey,
};
use async_graphql::connection::{query_with, Connection, Edge};
use async_graphql::OutputType;
use std::cmp::{max, min};
use std::mem::take;
use std::ops::RangeBounds;

/// GraphQL Pagination through TableIndex
///
/// This allows you to query a [TableIndex] using the
/// [GraphQL Pagination Spec](https://graphql.org/learn/pagination/).
///
/// [range], [gt], [ge], [lt], [le], [gt_raw], [ge_raw],
/// [lt_raw], and [le_raw] define a range. The range initially
/// covers the entire index; each of these functions shrink it
/// (set intersection).
///
/// [first], [last], [before], and [after] page through the range.
/// They conform to the Pagination Spec, except [query] produces an
/// error if both `first` and `last` are Some.
pub struct TableQuery<'a, Key: ToKey, Record: TableRecord> {
    index: &'a TableIndex<Key, Record>,
    first: Option<i32>,
    last: Option<i32>,
    before: Option<String>,
    after: Option<String>,
    begin: Option<RawKey>,
    end: Option<RawKey>,
}

impl<'a, Key: ToKey, Record: TableRecord + OutputType> TableQuery<'a, Key, Record> {
    pub fn new(table_index: &'a TableIndex<Key, Record>) -> Self {
        Self {
            index: table_index,
            first: None,
            last: None,
            before: None,
            after: None,
            begin: None,
            end: None,
        }
    }

    /// Limit the result to the first `n` (if Some) matching records.
    ///
    /// This replaces the current value.
    pub fn first(mut self, n: Option<i32>) -> Self {
        self.first = n;
        self
    }

    /// Limit the result to the last `n` (if Some) matching records.
    ///
    /// This replaces the current value.
    pub fn last(mut self, n: Option<i32>) -> Self {
        self.last = n;
        self
    }

    /// Resume paging. Limits the result to records before `cursor`
    /// (if Some). `cursor` is opaque; get it from a
    /// previously-returned [Connection].
    ///
    /// This replaces the current value.
    pub fn before(mut self, cursor: Option<String>) -> Self {
        self.before = cursor;
        self
    }

    /// Resume paging. Limits the result to records after `cursor`
    /// (if Some). `cursor` is opaque; get it from a
    /// previously-returned [Connection].
    ///
    /// This replaces the current value.
    pub fn after(mut self, cursor: Option<String>) -> Self {
        self.after = cursor;
        self
    }

    fn with_key<F: FnOnce(Self, RawKey) -> Self>(self, key: Option<&Key>, f: F) -> Self {
        if let Some(key) = key {
            let mut raw = self.index.prefix.clone();
            key.append_key(&mut raw);
            f(self, RawKey::new(raw))
        } else {
            self
        }
    }

    /// Limit the result to records with keys greater than `key`.
    ///
    /// If `key` is Some then this intersects with the existing range.
    pub fn gt(self, key: Option<&Key>) -> Self {
        self.with_key(key, |this, k| this.gt_raw(k))
    }

    /// Limit the result to records with keys greater than or
    /// equal to `key`.
    ///
    /// If `key` is Some then this intersects with the existing range.
    pub fn ge(self, key: Option<&Key>) -> Self {
        self.with_key(key, |this, k| this.ge_raw(k))
    }

    /// Limit the result to records with keys less than `key`.
    ///
    /// If `key` is Some then this intersects with the existing range.
    pub fn lt(self, key: Option<&Key>) -> Self {
        self.with_key(key, |this, k| this.lt_raw(k))
    }

    /// Limit the result to records with keys less than or
    /// equal to `key`.
    ///
    /// If `key` is Some then this intersects with the existing range.
    pub fn le(self, key: Option<&Key>) -> Self {
        self.with_key(key, |this, k| this.le_raw(k))
    }

    /// Limit the result to records with keys within range.
    ///
    /// This intersects with the existing range.
    pub fn range(mut self, bounds: impl RangeBounds<Key>) -> Self {
        self = match bounds.start_bound() {
            std::ops::Bound::Included(b) => self.ge(Some(b)),
            std::ops::Bound::Excluded(b) => self.gt(Some(b)),
            std::ops::Bound::Unbounded => self,
        };
        match bounds.end_bound() {
            std::ops::Bound::Included(b) => self.le(Some(b)),
            std::ops::Bound::Excluded(b) => self.lt(Some(b)),
            std::ops::Bound::Unbounded => self,
        }
    }

    /// Limit the result to records with keys greater than `key`.
    ///
    /// This intersects with the existing range. `key` must include
    /// the index's prefix.
    pub fn gt_raw(self, mut key: RawKey) -> Self {
        key.data.push(0);
        self.ge_raw(key)
    }

    /// Limit the result to records with keys greater than or
    /// equal to `key`.
    ///
    /// This intersects with the existing range. `key` must include
    /// the index's prefix.
    pub fn ge_raw(mut self, key: RawKey) -> Self {
        if let Some(begin) = self.begin {
            self.begin = Some(max(begin, key));
        } else {
            self.begin = Some(key);
        }
        self
    }

    /// Limit the result to records with keys less than `key`.
    ///
    /// This intersects with the existing range. `key` must include
    /// the index's prefix.
    pub fn lt_raw(mut self, key: RawKey) -> Self {
        if let Some(end) = self.end {
            self.end = Some(min(end, key));
        } else {
            self.end = Some(key);
        }
        self
    }

    /// Limit the result to records with keys less than or
    /// equal to `key`.
    ///
    /// This intersects with the existing range. `key` must include
    /// the index's prefix.
    pub fn le_raw(self, mut key: RawKey) -> Self {
        key.data.push(0);
        self.lt_raw(key)
    }

    fn get_value_from_bytes(&self, bytes: Vec<u8>) -> Option<Record> {
        if self.index.is_secondary {
            kv_get(self.index.db_id, &RawKey::new(bytes)).unwrap()
        } else {
            Some(Record::unpack(&bytes[..], &mut 0).unwrap())
        }
    }

    fn next(&mut self) -> Option<(&[u8], Record)> {
        let key = self
            .begin
            .as_ref()
            .map_or(&self.index.prefix[..], |k| &k.data[..]);
        let value = kv_greater_equal_bytes(self.index.db_id, key, self.index.prefix.len() as u32);

        if let Some(value) = value {
            self.begin = Some(RawKey::new(get_key_bytes()));
            if self.end.is_some() && self.begin >= self.end {
                return None;
            }
            self.begin.as_mut().unwrap().data.push(0);
            let k = &self.begin.as_ref().unwrap().data;
            self.get_value_from_bytes(value)
                .map(|v| (&k[..k.len() - 1], v))
        } else {
            None
        }
    }

    fn next_back(&mut self) -> Option<(&[u8], Record)> {
        let value = if let Some(back_key) = &self.end {
            kv_less_than_bytes(
                self.index.db_id,
                &back_key.data[..],
                self.index.prefix.len() as u32,
            )
        } else {
            kv_max_bytes(self.index.db_id, &self.index.prefix)
        };

        if let Some(value) = value {
            self.end = Some(RawKey::new(get_key_bytes()));
            if self.end <= self.begin {
                return None;
            }
            let k = &self.end.as_ref().unwrap().data;
            self.get_value_from_bytes(value)
                .map(|v| (&k[..k.len() - 1], v))
        } else {
            None
        }
    }

    pub async fn query(mut self) -> async_graphql::Result<Connection<RawKey, Record>> {
        query_with(
            take(&mut self.after),
            take(&mut self.before),
            take(&mut self.first),
            take(&mut self.last),
            |after: Option<RawKey>, before, first, last| async move {
                let orig_begin = self.begin.clone();
                let orig_end = self.end.clone();
                if let Some(after) = &after {
                    self = self.gt_raw(after.clone());
                }
                if let Some(before) = &before {
                    self = self.lt_raw(before.clone());
                }

                let mut items = Vec::new();
                if let Some(n) = last {
                    while items.len() < n {
                        if let Some((k, v)) = self.next_back() {
                            items.push((k.to_owned(), v));
                        } else {
                            break;
                        }
                    }
                    items.reverse();
                } else {
                    let n = first.unwrap_or(usize::MAX);
                    while items.len() < n {
                        if let Some((k, v)) = self.next() {
                            items.push((k.to_owned(), v));
                        } else {
                            break;
                        }
                    }
                }

                let mut has_previous_page = false;
                let mut has_next_page = false;
                if let Some(item) = items.first() {
                    if kv_less_than_bytes(self.index.db_id, &item.0, self.index.prefix.len() as u32)
                        .is_some()
                    {
                        let found_key = RawKey::new(get_key_bytes());
                        has_previous_page =
                            orig_begin.is_none() || found_key >= orig_begin.unwrap();
                    }
                }
                if let Some(item) = items.last() {
                    let mut k = item.0.clone();
                    k.push(0);
                    if kv_greater_equal_bytes(self.index.db_id, &k, self.index.prefix.len() as u32)
                        .is_some()
                    {
                        let found_key = RawKey::new(get_key_bytes());
                        has_next_page = orig_end.is_none() || found_key < orig_end.unwrap();
                    }
                }

                let mut conn = Connection::new(has_previous_page, has_next_page);
                conn.edges
                    .extend(items.into_iter().map(|(k, v)| Edge::new(RawKey::new(k), v)));
                Ok::<_, &'static str>(conn)
            },
        )
        .await
    }
}
