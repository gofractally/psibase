# Requirements — Authenticated query pattern rollout

**Team:** `mm/authenticated-system-queries`
**Worktree:** `/root/psibase`
**Phase:** 0 (Requirements)
**Owner (PM):** drafted from User direction on 2026‑05‑04

## 1. Problem statement

Several `psibase` system services expose user‑linked data through GraphQL (and a few through HTTP) without binding the response to the authenticated caller. The codebase already has a working **authenticated query pattern** — `serveSys(request, socket, user)` + `Query { user }` + per‑field `check_user_auth` — used by `VirtualServer` (system) and `Tokens` (user). The goal of this project is to roll that pattern out to system services that should be using it but currently are not.

## 2. Goal

For every in‑scope system service:

1. Thread the authenticated `user: Option<AccountNumber>` from `http-server` into the service’s GraphQL (or equivalent) layer.
2. Gate every user‑linked field/route with an authorization check that allows either:
   - `user == subject`, **or**
   - `psibase::is_auth(subject, Some(<service-method>), authorizers)` (delegated reads).
3. Provide tests that exercise the guard for both authorized and unauthorized callers.
4. Where the service is implemented in C++, implement the equivalent C++ pattern (see §6).
5. Do not change the underlying HTTP identity mechanism (`RTransact::getUser`, JWT/cookie format, etc.).

## 3. In‑scope services

| # | Service | Path | Language | Notes |
|---|---------|------|----------|-------|
| 1 | StagedTx query | `packages/system/StagedTx/query-service/src/lib.rs` | Rust | Indexed by `party` / `actor`; payloads + history |
| 2 | AuthDyn query | `packages/system/AuthDyn/query-service/src/lib.rs` | Rust | Per‑account management surface |
| 3 | RTransact GraphQL | `packages/system/Transact/src/RTransact.cpp` | C++ | `TransactQuery` / `snapshotInfo`; HTTP login/admin paths already use `user` and are out of scope here |
| 4 | RAccounts | `packages/system/Accounts/src/RAccounts.cpp` | C++ | `getAccount` / `getAccounts` |
| 5 | RAuthDelegate | `packages/system/AuthDelegate/src/RAuthDelegate.cpp` | C++ | Delegation edges (`owned`, `owner`) |

For each, the migration is "complete" when the acceptance criteria in §5 are met.

## 4. Default pattern variant

- **Delegated (VirtualServer‑style)** is the default for every in‑scope service.
- A service may downgrade to the **strict** variant (`user == subject` only) iff the architect documents in `architecture.md` why delegation is unsafe for that service.

Reference implementation to mirror: `packages/system/VirtualServer/service/src/rpc.rs` (`check_user_auth`, `serve_sys()` helper, `Query { user }`, `serveSys` wiring at `packages/system/VirtualServer/service/src/lib.rs:614`).

## 5. Acceptance criteria (per service)

A service migration is **done** when all of the following hold:

- **Wiring**
  - `serveSys` accepts `user: Option<AccountNumber>` (Rust) / equivalent third arg (C++) and forwards it into the GraphQL root.
  - `Query` (or equivalent root) carries `user: Option<AccountNumber>`.
- **Authorization**
  - Every field that returns or filters on user‑linked data calls a `check_user_auth(subject)` helper before producing data.
  - Default `check_user_auth` implementation matches the VirtualServer (delegated) shape, calling `psibase::is_auth(subject, Some(<this service’s serveSys ServiceMethod>), authorizers)`.
  - Unauthenticated or mismatched callers receive a clear permission‑denied error (no silent empty results that leak existence/non‑existence beyond what is already public).
- **Tests**
  - At least one positive test using the standardized `graphql_auth` helper (see §7) that proves an authorized caller can read.
  - At least one negative test that proves an unauthenticated and a wrong‑subject caller are rejected.
  - Where delegation is supported, one test that proves an `is_auth`‑delegated caller succeeds.
- **No regressions**
  - Public/non‑user fields remain accessible without a token.
  - Existing callers of `serveSys` (i.e., `http-server`) keep working; no breakage in the `RTransact::getUser` → `serveSys` contract.

## 6. C++ pattern parity

C++ services are first‑class in this project. Phase 1 (architecture) must produce:

- A documented C++ counterpart to the Rust `Query { user } + check_user_auth + is_auth` shape, including how `serveSys` receives `user`, how the GraphQL reflection wrapper threads it, and the C++ binding for `is_auth` (or, if missing, a spec for adding one).
- A reference C++ migration (recommended: `RAccounts`) that subsequent C++ migrations follow.

If a C++ binding for `is_auth` is missing, designing/adding it is in scope; the architect calls it out in `architecture.md`.

## 7. Cross‑cutting deliverables

- **Documentation**
  - Update `doc/src/development/services/rust-service/graphql.md` and `doc/src/development/services/rust-service/reference/web-services.md` to show the `serveSys(request, socket, user)` / `Query { user }` / `check_user_auth` pattern as the recommended default for any service that returns user‑linked data.
  - Add or extend the C++ services docs with the parity pattern from §6.
- **Test helper**
  - Audit `chain.graphql_auth` and the surrounding tester surface (`rust/psibase/src/tester.rs` ~758–821) and standardize a single recommended helper for "authenticated GraphQL query expecting success" and "authenticated GraphQL query expecting permission‑denied". Document it where the service test conventions live.

## 8. Explicitly out of scope (this project)

The following services exposing user‑linked data are **not** migrated in this round. They will be triaged with the broader team after this project ships, and a follow‑up GitHub issue will be opened for each that still needs the pattern.

| Service | Path | Why deferred |
|---------|------|--------------|
| RAuthSig | `packages/system/AuthSig/src/RAuthSig.cpp` | Public‑key ↔ account linkage; sensitivity is a policy call |
| RProducers | `packages/system/Producers/src/RProducers.cpp` | Producer info typically public chain state |
| RSetCode | `packages/system/SetCode/src/RSetCode.cpp` | Code‑deploy info typically public chain state |
| Any other system service surfaced during phase 1 | — | Tracked in the same follow‑up |

Also out of scope:

- Changing the JWT format, login flow, cookie names, or `RTransact::getUser` behavior.
- Migrating user‑tier services (`packages/user/...`) beyond what is required to keep them building.
- Changing the on‑chain `is_auth` semantics.

## 9. Open questions (escalate to broader team)

1. **Plugin shims (`authorized::graphql`):** should every migrated service also ship/update a plugin shim (matching `Tokens` and `VirtualServer`), and if so, with what whitelist policy? Document the answer before phase 1 closes; until then, do not implement plugin shims in this project.
2. **Post‑project triage:** which of the deferred services in §8 actually need the pattern? Owner: PM, after architect input.

## 10. Phase plan (high level)

- **Phase 0 (this doc):** requirements approved.
- **Phase 1:** Senior/Architect produce `architecture.md` covering the Rust default flow, the C++ parity pattern (§6), the test helper standardization (§7), and a per‑service migration checklist; plus the test strategy.
- **Phase 2:** task‑by‑task migration of the five in‑scope services (§3), each with full acceptance criteria (§5), reviewed before completion.
