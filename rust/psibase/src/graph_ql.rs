use crate::{
    get_key_bytes, get_sequential_bytes, kv_get, kv_greater_equal_bytes, kv_less_than_bytes,
    kv_max_bytes, AccountNumber, DbId, MethodNumber, RawKey, TableIndex, TableRecord, ToKey,
};
use anyhow::anyhow;
use async_graphql::connection::{query_with, Connection, Edge};
use async_graphql::OutputType;
use fracpack::{Unpack, UnpackOwned};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer};
use serde_json::Value;
use std::cmp::{max, min};
use std::collections::HashMap;
use std::mem::take;
use std::ops::RangeBounds;

/// GraphQL Pagination through TableIndex
///
/// This allows you to query a [TableIndex] using the
/// [GraphQL Pagination Spec](https://graphql.org/learn/pagination/).
///
/// [range](Self::range), [gt](Self::gt), [ge](Self::ge),
/// [lt](Self::lt), [le](Self::le), [gt_raw](Self::gt_raw),
/// [ge_raw](Self::ge_raw), [lt_raw](Self::lt_raw), and
/// [le_raw](Self::le_raw) define a range. The range initially
/// covers the entire index; each of these functions shrink it
/// (set intersection).
///
/// [first](Self::first), [last](Self::last), [before](Self::before),
/// and [after](Self::after) page through the range. They conform to
/// the Pagination Spec, except [query](Self::query) produces an
/// error if both `first` and `last` are Some.
pub struct TableQuery<Key: ToKey, Record: TableRecord> {
    index: TableIndex<Key, Record>,
    first: Option<i32>,
    last: Option<i32>,
    before: Option<String>,
    after: Option<String>,
    begin: Option<RawKey>,
    end: Option<RawKey>,
}

impl<Key: ToKey, Record: TableRecord + OutputType> TableQuery<Key, Record> {
    /// Query a table's index
    pub fn new(table_index: TableIndex<Key, Record>) -> Self {
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

    /// Query a subindex of a table
    pub fn subindex<RemainingKey: ToKey>(
        table_index: TableIndex<Key, Record>,
        subkey: &impl ToKey,
    ) -> TableQuery<RemainingKey, Record> {
        let mut prefix = table_index.prefix;
        subkey.append_key(&mut prefix);
        TableQuery {
            index: TableIndex::new(table_index.db_id, prefix, table_index.is_secondary),
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
    /// previously-returned
    /// [Connection](async_graphql::connection::Connection).
    ///
    /// This replaces the current value.
    pub fn before(mut self, cursor: Option<String>) -> Self {
        self.before = cursor;
        self
    }

    /// Resume paging. Limits the result to records after `cursor`
    /// (if Some). `cursor` is opaque; get it from a
    /// previously-returned
    /// [Connection](async_graphql::connection::Connection).
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

pub fn get_event_in_db<T: DecodeEvent>(db: DbId, event_id: u64) -> Result<T, anyhow::Error> {
    let Some(data) = get_sequential_bytes(db, event_id) else {
        return Err(anyhow!("Event not found"));
    };
    let (_, Some(type_)) = <(AccountNumber, Option<MethodNumber>)>::unpacked(&data)? else {
        return Err(anyhow!("Missing event type"));
    };
    T::decode(type_, &data)
}

pub fn get_event<T: DecodeEvent + EventDb>(event_id: u64) -> Result<T, anyhow::Error> {
    get_event_in_db(T::db(), event_id)
}

pub trait DecodeEvent {
    fn decode(type_: MethodNumber, data: &[u8]) -> Result<Self, anyhow::Error>
    where
        Self: Sized;
}

pub fn decode_event_data<T: UnpackOwned>(data: &[u8]) -> Result<T, anyhow::Error> {
    let (_, _, Some(content)) = <(AccountNumber, Option<MethodNumber>, Option<T>)>::unpacked(data)?
    else {
        return Err(anyhow!("Missing event data"));
    };
    Ok(content)
}

impl<T: UnpackOwned + NamedEvent> DecodeEvent for T {
    fn decode(type_: MethodNumber, data: &[u8]) -> Result<T, anyhow::Error> {
        if type_ != <T as NamedEvent>::name() {
            return Err(anyhow!("Wrong event type"));
        }
        decode_event_data::<T>(data)
    }
}

pub trait NamedEvent {
    fn name() -> MethodNumber;
}

pub trait EventDb {
    fn db() -> DbId;
}

#[derive(Debug)]
struct SqlRow {
    rowid: u64,
    data: Value,
}

impl<'de> Deserialize<'de> for SqlRow {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let mut map: HashMap<String, Value> = HashMap::deserialize(deserializer)?;

        let rowid = map
            .remove("rowid")
            .and_then(|v| match v {
                Value::String(s) => s.parse::<u64>().ok(),
                _ => None,
            })
            .ok_or_else(|| serde::de::Error::missing_field("rowid"))?;

        let data = Value::Object(map.into_iter().collect());

        Ok(SqlRow { rowid, data })
    }
}

/// GraphQL Pagination through Event tables
///
/// Event tables are stored in an SQLite database in a service.
///
/// This interface allows you to query the event tables using the
/// [GraphQL Pagination Spec](https://relay.dev/graphql/connections.htm).
///
/// [condition](Self::condition) defines a SQL WHERE clause filter.
/// [first](Self::first), [last](Self::last), [before](Self::before),
/// and [after](Self::after) page through the results.
///
/// They conform to the Pagination Spec, except that simultaneous `first`
/// and `last` arguments are forbidden, rather than simply discouraged.
pub struct EventQuery<T: DeserializeOwned + OutputType> {
    table_name: String,
    condition: Option<String>,
    first: Option<i32>,
    last: Option<i32>,
    before: Option<String>,
    after: Option<String>,
    debug: bool,
    _phantom: std::marker::PhantomData<T>,
}

impl<T: DeserializeOwned + OutputType> EventQuery<T> {
    /// Create a new query for the given table
    pub fn new(table_name: impl Into<String>) -> Self {
        Self {
            table_name: format!("\"{}\"", table_name.into()),
            condition: None,
            first: None,
            last: None,
            before: None,
            after: None,
            debug: false,
            _phantom: std::marker::PhantomData,
        }
    }

    /// Enable debug output printing
    pub fn with_debug_output(mut self) -> Self {
        self.debug = true;
        self
    }

    /// Add a SQL WHERE clause condition to filter results
    ///
    /// This replaces the current condition if one exists.
    pub fn condition(mut self, condition: impl Into<String>) -> Self {
        self.condition = Some(condition.into());
        self
    }

    /// Limit the result to the first `n` (if Some) matching records.
    ///
    /// This replaces the current value. Returns error if n is negative.
    pub fn first(mut self, first: Option<i32>) -> Self {
        if let Some(n) = first {
            if n < 0 {
                crate::abort_message("'first' cannot be negative");
            }
        }
        self.first = first;
        self
    }

    /// Limit the result to the last `n` (if Some) matching records.
    ///
    /// This replaces the current value. Returns error if n is negative.
    pub fn last(mut self, last: Option<i32>) -> Self {
        if let Some(n) = last {
            if n < 0 {
                crate::abort_message("'last' cannot be negative");
            }
        }
        self.last = last;
        self
    }

    /// Resume paging. Limits the result to records before `cursor`
    /// (if Some). `cursor` is opaque; get it from a
    /// previously-returned
    /// [Connection](async_graphql::connection::Connection).
    ///
    /// This replaces the current value.
    pub fn before(mut self, before: Option<String>) -> Self {
        self.before = before;
        self
    }

    /// Resume paging. Limits the result to records after `cursor`
    /// (if Some). `cursor` is opaque; get it from a
    /// previously-returned
    /// [Connection](async_graphql::connection::Connection).
    ///
    /// This replaces the current value.
    pub fn after(mut self, after: Option<String>) -> Self {
        self.after = after;
        self
    }

    fn has_row_after(&self, cursor: &str) -> bool {
        let next_query = self.generate_sql_query(Some(1), false, None, Some(cursor.to_string()));
        Self::has_rows(next_query)
    }

    fn has_row_before(&self, cursor: &str) -> bool {
        let prev_query = self.generate_sql_query(Some(1), false, Some(cursor.to_string()), None);
        Self::has_rows(prev_query)
    }

    fn has_rows(query: String) -> bool {
        let json = crate::services::r_events::Wrapper::call().sqlQuery(query);
        let rows: Vec<SqlRow> = serde_json::from_str(&json).unwrap_or_default();
        !rows.is_empty()
    }

    fn has_next(
        &self,
        rows: &[SqlRow],
        before: Option<&String>,
        first: Option<i32>,
        last: Option<i32>,
    ) -> bool {
        if let Some(before_cursor) = before {
            self.has_row_after(before_cursor)
        } else {
            match first.or(last) {
                Some(n) => rows.len() > n as usize,
                None => false,
            }
        }
    }

    fn has_previous(&self, rows: &[SqlRow], after: Option<&String>) -> bool {
        if let Some(after_cursor) = after {
            self.has_row_before(after_cursor)
        } else if let Some(first_row) = rows.first() {
            self.has_row_before(&first_row.rowid.to_string())
        } else {
            false
        }
    }

    fn generate_sql_query(
        &self,
        limit: Option<i32>,
        descending: bool,
        before: Option<String>,
        after: Option<String>,
    ) -> String {
        let mut filters = vec![];
        if let Some(cond) = &self.condition {
            if !cond.trim().is_empty() {
                filters.push(cond.clone());
            }
        }
        if let Some(b) = before.and_then(|s| s.parse::<u64>().ok()) {
            filters.push(format!("ROWID < {}", b));
        }
        if let Some(a) = after.and_then(|s| s.parse::<u64>().ok()) {
            filters.push(format!("ROWID > {}", a));
        }

        let order = if descending { "DESC" } else { "ASC" };
        let mut query = format!("SELECT ROWID, * FROM {}", self.table_name);

        if !filters.is_empty() {
            query.push_str(" WHERE ");
            query.push_str(&filters.join(" AND "));
        }

        query.push_str(&format!(" ORDER BY ROWID {order}"));

        if let Some(l) = limit {
            query.push_str(&format!(" LIMIT {l}"));
        }

        query
    }

    /// Execute the query and return a Connection containing the results
    ///
    /// Returns error if both first and last are specified.
    pub fn query(&self) -> async_graphql::Result<Connection<u64, T>> {
        if self.first.is_some() && self.last.is_some() {
            crate::abort_message("Cannot specify both 'first' and 'last'");
        }

        let (limit_plus_one, descending) = match (self.first, self.last) {
            (Some(n), None) => (Some(n + 1), false),
            (None, Some(n)) => (Some(n + 1), true),
            (None, None) => (None, false),
            _ => unreachable!(),
        };

        let query = self.generate_sql_query(
            limit_plus_one,
            descending,
            self.before.clone(),
            self.after.clone(),
        );

        let json_str = crate::services::r_events::Wrapper::call().sqlQuery(query);
        if self.debug {
            println!("Raw JSON string: {}", json_str);
        }
        let mut rows: Vec<SqlRow> = serde_json::from_str(&json_str).unwrap_or_else(|e| {
            if self.debug {
                println!("Failed to deserialize rows: {}", e);
            }
            crate::abort_message(&format!("Failed to deserialize rows: {}", e))
        });

        let has_next = self.has_next(&rows, self.before.as_ref(), self.first, self.last);
        let has_previous = self.has_previous(&rows, self.after.as_ref());

        if let Some(user_limit) = self.first.or(self.last) {
            if rows.len() > user_limit as usize {
                rows.truncate(user_limit as usize);
            }
        }

        if self.last.is_some() {
            rows.reverse();
        }

        let mut connection = Connection::new(has_previous, has_next);
        for row in rows {
            if self.debug {
                println!("Row data: {}", row.data);
            }
            match serde_json::from_value(row.data) {
                Ok(data) => {
                    connection.edges.push(Edge::new(row.rowid, data));
                }
                Err(e) => {
                    if self.debug {
                        println!("Failed to deserialize row {}: {}", row.rowid, e);
                    }
                    crate::abort_message(&format!(
                        "Failed to deserialize row {}: {}",
                        row.rowid, e
                    ));
                }
            }
        }

        if !connection.edges.is_empty() {
            connection.has_previous_page = has_previous;
            connection.has_next_page = has_next;
        }

        Ok(connection)
    }
}
