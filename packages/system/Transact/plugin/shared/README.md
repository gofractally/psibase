# Transaction context guards

`open_tx_table.rs` is shared by native Transact's main and admin components.
Their Host DB identity is the same `transact` service, and the context is
ephemeral: `start-tx` clears it before any app plugin function runs.

The connection pin records the selected account at transaction start. If no
account is selected yet, it binds at the first scheduled action, including an
explicit `None` connection used by account-creation flows with sender hooks and
extra signatures. Logging in before that first action is supported. Once bound,
login/logout or a different account selection aborts financial publication.
Zero-action login/account-switch calls intentionally do not validate the old
pin at finish, because they publish no financial transaction.

Default action senders, claims and proofs use the captured connection. Native
Transact checks the authoritative Host account before scheduling, after sender
callbacks, before transaction construction, after proofs, after each publication
callback, and immediately before the RPC. Explicit sender/proposal hooks retain
their existing authority; the connection pin does not substitute its account
for an intentionally selected action sender.

`hooks.register-pre-publish-hook` registers only its authenticated caller service,
at most once per service, with a hard cap of 16. It accepts no target service,
plugin name or interface from an app. Callbacks resolve dynamically to
`<caller>:plugin/transact-hook-pre-publish::on-pre-publish`. No optional service
is a static platform dependency. The callback receives only the sender and
service of every actual signed action, after proofs and before broadcast. It
must validate its own native Transact caller. A rejection stops publication.
During callbacks, new action scheduling and hook registration are rejected.
There is no API to remove another plugin's guard.

Publication guards may commit only their own state deliberately. In particular,
Tokens uses this boundary to permanently spend exact approvals before attempting
the RPC. An unknown or rejected transaction cannot revive one-shot permission.
Other transactional Host stores keep their normal success/rollback behavior;
Transact does not flush all client data before publishing.

The trusted browser Supervisor serializes complete native entries with an
origin-wide exclusive Web Lock. This covers asynchronous loading, start/function/
finish, proofs and publication, and releases on a prompt or error. Combined with
Tokens' shared persistent nonce/spent store, duplicated session-storage tabs
cannot spend the same one-time authorization twice. Unsupported browsers fail
closed rather than fall back to an unsafe per-tab mutex. The connection pin is
still checked independently of this browser coordination.

This whole-context browser lock extends a malicious plugin's liveness impact
across native apps/tabs in the same storage partition: an infinite synchronous
WASM loop or stalled HTTP call can hold the lock until its tab/frame is closed.
The chain, public HTTP book and external bots remain live. A production client
needs worker isolation with enforced termination/deadlines or a narrower atomic
approval-store protocol. Merely timing out a waiter does not stop the holder;
stealing a lock while its callback can still publish is unsafe. This is a
documented client availability limitation, independent of financial authority.

Pure policy tests exercise the exact connection/registry code used by OpenTx:

```sh
rustc --edition=2021 --test transaction_policy.rs -o /tmp/transaction-policy-tests
/tmp/transaction-policy-tests
```

Runtime validation must additionally check dynamic callback dispatch, same-origin
caller enforcement, partial construction/signing prompts, actual cross-tab
selection changes, and submitted transactions with unknown/rejected responses.
The host policy tests alone do not establish those integration guarantees.
