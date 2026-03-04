# Skill: service-tables

**Name:** service-tables  
**When to load:** Story involves service storage: defining or changing tables, primary/secondary keys, fields, or indexes in a Rust service.  
**Prerequisites:** Rust service exists (`#[psibase::service]`); basic familiarity with `doc/src/development/services/rust-service/`.

---

## Core Knowledge

- Tables live in a `#[psibase::service_tables] mod tables { ... }` block. Each table is a struct with `#[table(name = "...", index = N)]`. The **index is stable forever**—do not renumber.
- Data is stored in psibase’s key/value store. Keys and records use **Fracpack**; structs need `Fracpack`, `Serialize`, `Deserialize`, `ToSchema`, and `ToKey` where used as keys.
- **Primary key**: one per table, via `#[primary_key]` on a field or method. **Secondary indexes**: `#[secondary_key(1)]`, `#[secondary_key(2)]`, etc. on **methods** that return a key (e.g. `(AccountNumber, u64)`). Secondary keys must be unique (often include primary key in the tuple).
- **Singletons**: table with at most one row; primary key method returns `()`.
- **Modifications**: You may only **add** new `Option<...>` fields **at the end** of an existing table. Do not change key definitions, renumber indexes, remove keys/tables, or change field types—or data can corrupt.

Full reference: `doc/src/development/services/rust-service/tables.md`, `ai/docs/psibase/rust-services.md`.

---

## Skill: add-table

1. Add a new struct in the `#[psibase::service_tables]` module with `#[table(name = "TableName", index = N)]`. Use the **next unused** table index (never reuse or renumber).
2. Derive `Fracpack`, `Serialize`, `Deserialize`, `ToSchema` (and `ToKey` if the type is used as a key elsewhere).
3. Add `#[primary_key]` on the field or method that defines the primary key (e.g. `pub id: u64` or `fn pk(&self) -> u64`).
4. In the service module, open the table with `TableName::new()` and use `get_index_pk()` for primary key access (e.g. `table.put(&row)`, `table.get_index_pk().get(&key)`, `table.get_index_pk().range(a..b).collect()`).

Example (minimal):

```rust
#[table(name = "MessageTable", index = 0)]
#[derive(Fracpack, Serialize, Deserialize, ToSchema)]
pub struct Message {
    #[primary_key]
    pub id: u64,
    pub from: AccountNumber,
    pub to: AccountNumber,
    pub content: String,
}
```

---

## Skill: add-field

- **New table:** Add the field to the struct with the right derives.
- **Existing table:** You may only add **new `Option<...>` fields at the end** of the struct. Do not add non-optional fields, add fields in the middle, change types, or remove fields—escalate to the user for migration.

---

## Skill: add-index

1. Add a **method** on the table struct that returns the key (e.g. `(AccountNumber, u64)`). The key must be **unique**; often it’s `(some_field, primary_key)`.
2. Annotate with `#[secondary_key(1)]`, `#[secondary_key(2)]`, etc. Use the next unused secondary index number; never renumber existing ones.
3. In the service, use `table.get_index_by_xyz()` (name derived from the method, e.g. `by_from` → `get_index_by_from()`) for range/gets.

Example:

```rust
impl Message {
    #[secondary_key(1)]
    fn by_from(&self) -> (AccountNumber, u64) { (self.from, self.id) }
}
// Usage: MessageTable::new().get_index_by_from().range((account, 0)..(account, u64::MAX))
```

**Gotcha:** New secondary indexes only get entries when rows are **put** after the change. Existing rows are not backfilled. Plan a migration (e.g. re-put rows) or document that the index applies only to new data.

---

## Skill: modify-table

- **Safe:** Add optional fields at the end only.
- **Unsafe (do not do without user approval):** Changing primary/secondary key definitions, renumbering tables or keys, removing keys/tables, changing field types, adding non-optional or mid-struct fields. Escalate; these require a migration strategy.

---

## Gotchas

- Table/index numbers and key definitions are **immutable** after first deploy. Renumbering or changing key shapes corrupts or misreads data.
- Secondary indexes are not backfilled for existing rows.
- Storing structs defined elsewhere: use a wrapper newtype in the service_tables module with `#[primary_key]`/`#[secondary_key]` on methods; the newtype can wrap the external struct. See “Storing Structs Defined Elsewhere” in `doc/src/development/services/rust-service/tables.md`.

---

## Verification

- `cargo build --target wasm32-wasip1` (or `cargo psibase build`) for the service.
- `cargo psibase test` if tests read tables: use `Table::with_service(SERVICE)` in tests so the table is opened for the correct service account (not `get_service()` which is 0 in test context).

---

## Related Skills

- **service-actions** — actions that read/write these tables.
- **service-graphql** — exposing table data via GraphQL (TableQuery, subindex).
- **service-testing** — testing code that asserts on table contents.

---

## References

- `doc/src/development/services/rust-service/tables.md`
- `ai/docs/psibase/rust-services.md`, `ai/docs/psibase/gotchas.md`
- `doc/src/specifications/data-formats/fracpack.md`
