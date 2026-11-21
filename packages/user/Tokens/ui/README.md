# Native transfer confirmation

This is the Tokens-owned prompt used by `tokens:plugin/transfer`. Build with
`node build.mjs`; it uses the repository's already-built native Common API
Supervisor client. Package metadata in `Tokens/service/Cargo.toml` includes
`ui/dist` as Tokens' Sites content. The prompt lives at
`/plugin/web/prompt/transfer` on the Tokens account's native subdomain.

The caller supplies no trusted display text, authenticated identity or permission
flag. The prompt reads its exact, normalized transfer from the Tokens plugin.
Its optional trust checkbox defaults to off and grants only transfers between
the current wallet and the requesting app, for all native tokens, on this chain
and browser. It does not authorize issuer, balance configuration, arbitrary
recipient, or arbitrary GraphQL functions. Existing `tokens:plugin/user` APIs
retain their existing broad High checks and compatibility whitelists.

Each new transfer method takes a fifth `expected-user` argument captured from
the account displayed when the user clicked. Tokens compares it with Host's
authoritative selected user before token lookups, trust checks or actions, and
checks the intent against Host again during authorization. It never uses this
argument to select an account or choose a transaction sender. A stale tab must
fail rather than charge another connected account with remembered trust.

Approval does not publish part of a composed transaction. The originating app
must return from the prompt and repeat the exact native plugin call after
checking `approval-status == "approved"` and unchanged selected user. Cancellation
returns `denied`; it must never be retried automatically. Unknown submission
results are not a reason to retry. Exact approvals expire after 300 seconds.
Composition stages their consumption in Host's transactional and ephemeral
storage, so another transfer prompt or a cancelled signing prompt does not
strand a multi-action withdrawal. After proofs have completed, native Transact
calls only the optional publication guards registered during this composition.
Tokens registers its own authenticated hook for both exact and remembered
transfers, and checks every actual signed Tokens action's sender against the
reviewed wallet. Other services' action senders are not restricted by this
wallet policy. Tokens then seals staged exact approvals in nontransactional
storage. They stay
spent even if the transaction is rejected, the RPC response is lost, or the
browser closes before publishing. A new attempt requires new consent; ordinary
transactional client stores retain their existing rollback behavior. At most
64 unfinished reviews exist per connected user/app; the native caller must keep
its action plan bounded as well. Transact has no static Tokens dependency.

One-time IDs come from a shared persistent monotonic counter. Pre-publication
spent flags are also persistent and nontransactional, so cloning a tab's session
storage cannot copy usable consent after another tab spends it. A TTL index
bounds live spent records to 64 per user/app and is saved before individual
flags, before any RPC can start. Explicit revocation records a shared nonce
cutoff, invalidating unfinished approvals in copied tabs as well.

Supervisor holds an origin-wide exclusive Web Lock around each complete native
call, including zero-action approval calls and asynchronous component loading.
This makes the persistent counter and spent check/write atomic across tabs in
the supported native client. The lock releases when a prompt unwinds, so it is
not held while waiting for the user's consent. Browsers without Web Locks fail
closed with a compatibility message; HTTPS or localhost and a supported browser
are required. There is no per-tab or local-storage-lock fallback. This protocol
assumes all native calls use the updated trusted Supervisor; deployments must
refresh stale client code when installing these changes.

The whole-context lock has a client liveness limitation: an untrusted plugin
that loops indefinitely or stalls synchronous HTTP while holding it also blocks
native calls from other apps/tabs in that browser's shared storage partition.
Closing the offending tab/frame releases the browser-held lock. Public order
book HTTP queries, background bots and chain execution are unaffected; this does
not add fund or signing authority. Production must isolate plugin execution in
a terminable worker with deadlines, or move grant nonce/check-and-spend into a
narrow atomic store transaction. A wait timeout alone cannot terminate a held
callback, and stealing the lock would let the old callback keep publishing and
invalidate the at-most-once guarantee. No such unsafe fallback is implemented.

Native Transact also pins the connected account for the transaction context,
uses that captured user for default action senders, claims and proofs, and
checks Host's selection again after signing and publication callbacks. A user
selected in another browser tab cannot silently change a transaction during
synchronous HTTP work. This connection guard preserves intentional proposal and
explicit sender hooks; it does not require unrelated action senders to equal the
connected account. Zero-action login/switch calls remain supported.

Trust is stored by Tokens in encrypted Host persistent storage. Host namespaces
that storage by chain and authenticated plugin service, and Tokens keys it by
selected user and authenticated calling app. `trust-status` and `revoke-trust`
are scoped to the current active app/user. Revocation also drops unused exact
approvals. This is client authorization, independent of token `AUTO_DEBIT`,
on-chain shared balances, native signing keys, and account authentication.

`transfer.history` derives the user and requesting app from Host, caps pages at
100 events, quotes cursors as GraphQL strings, and filters returned native events
to the exact user/counterparty. It accepts no user name or arbitrary query. The
native GraphQL counterparty search currently uses substring matching, so the
additional exact output filter is required.

Run deterministic exact-policy tests with:

```sh
rustc --edition=2021 --test ../plugin/src/transfer_policy.rs -o /tmp/token-transfer-tests
/tmp/token-transfer-tests
```

The Supervisor test suite also checks lock lifetime, prompt release, unsupported
browsers and simultaneous copied-session submissions against shared spent state:

```sh
yarn workspace @psibase/supervisor-ui test
```

The browser integration must additionally exercise approval, cancellation,
remembered trust, revocation, a changed account, composed withdrawal, and native
transaction failure. The pure tests do not establish those runtime guarantees.
