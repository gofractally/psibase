# Skill: service-graphql

**Name:** service-graphql  
**When to load:** Story involves GraphQL for a Rust service: adding queries, exposing table data, or pagination.  
**Prerequisites:** Rust service with HTTP handling (serveSys); optionally service-tables for table-backed queries.

---

## Core Knowledge

- GraphQL is served via **async-graphql**. The psibase library provides `serve_graphql(&request, Query)` and `serve_graphiql(&request)` for the playground.
- In `serveSys`, chain handlers: e.g. `None.or_else(|| serve_simple_ui::<Wrapper>(&request)).or_else(|| serve_graphql(&request, Query)).or_else(|| serve_graphiql(&request))`.
- **Table-backed pagination:** Use `TableQuery::new(index).first(...).last(...).before(...).after(...).query().await` for GraphQL connections (Cursor-based). For a single secondary key fixed (e.g. “messages by from”), use `TableQuery::subindex::<RemainingKey>(index, &subkey).first(...).query().await`.
- Query handlers run in HTTP context: **read-only** (no DB writes) for determinism.

Refs: `doc/src/development/services/rust-service/graphql.md`, `ai/docs/psibase/rust-services.md`.

---

## Skill: add-query

1. Define a root struct (e.g. `struct Query;`) and implement `#[async_graphql::Object]` with `async fn` methods.
2. Each method can take arguments and return types that async-graphql supports (including Vec, Option). For table data, open the table in the resolver and iterate or use `TableQuery`.
3. Register in `serveSys`: `.or_else(|| serve_graphql(&request, Query))` (and optionally `serve_graphiql` for /graphiql.html).
4. Table structs exposed in GraphQL need `SimpleObject` (or equivalent) and field types compatible with GraphQL; often the same structs use `ToSchema` for psibase and `SimpleObject` for GraphQL.

Example (simple):

```rust
struct Query;
#[async_graphql::Object]
impl Query {
    async fn add(&self, a: i32, b: i32) -> i32 { a + b }
}
```

---

## Skill: expose-table-via-graphql

1. Ensure the table struct has GraphQL-friendly derives (e.g. `SimpleObject`). Primary/secondary key types (e.g. `AccountNumber`) must be GraphQL-expressible (psibase often provides or you map).
2. In the Query impl, add a resolver that opens the table and returns data. For **paginated** list:
   - Use `TableQuery::new(MessageTable::new().get_index_pk()).first(first).last(last).before(before).after(after).query().await` and return `Connection<RawKey, Message>` (or the appropriate key/record types).
   - For a **filtered** list by one index (e.g. by sender): use `TableQuery::subindex::<u64>(MessageTable::new().get_index_by_from(), &from).first(...).after(...).query().await`.
3. Document args (e.g. `first`, `after`) in the resolver; they appear in the schema.

Example (pagination):

```rust
async fn messages(
    &self,
    first: Option<i32>, after: Option<String>,
    last: Option<i32>, before: Option<String>,
) -> async_graphql::Result<Connection<RawKey, Message>> {
    TableQuery::new(MessageTable::new().get_index_pk())
        .first(first).last(last).before(before).after(after)
        .query().await
}
```

---

## Gotchas

- **Read-only:** GraphQL runs in query context; do not write to tables in resolvers.
- **Subindex types:** `TableQuery::subindex::<RemainingKey>(index, &subkey)` — `RemainingKey` is the type of the remaining key part; if the full key is `(AccountNumber, u64)`, holding `AccountNumber` constant leaves `u64`. Mismatches cause wrong cursor/behavior.
- **Labels:** Clients can query the same field multiple times with labels (e.g. `x: add(a:1,b:2), y: add(a:3,b:4)`).

---

## Verification

- Deploy with `cargo psibase install`; open service’s `/graphiql.html` and run a query. For pagination, check `pageInfo` and `edges.node`.

---

## Related Skills

- **service-tables** — tables and indexes used in TableQuery.
- **service-actions** — serveSys and any internal helpers.
- **ui-supervisor-integration** — UI calling GraphQL (e.g. via plugin’s post-graphql-get-json).

---

## References

- `doc/src/development/services/rust-service/graphql.md`
- `ai/docs/psibase/rust-services.md`
