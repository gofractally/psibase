# Call flows

How a call travels from an app's page to the node and back. Every pattern here is in use; the file and function names are the real ones, so each step can be followed in the source.

- [Where things run](#where-things-run)
- [A. Every plugin call](#a-every-plugin-call)
- [B. A read](#b-a-read)
- [C. A write](#c-a-write)
- [D. One plugin calling another](#d-one-plugin-calling-another)
- [E. Asking the user](#e-asking-the-user)
- [Worked example: another app's balances](#worked-example-another-apps-balances)
- [Where this is going: asynchronous calls](#where-this-is-going-asynchronous-calls)
- [Known limits](#known-limits)

## Where things run

```
Browser
├── App page                 https://myapp.<root>         your UI; no keys, no tokens
│   └── hidden iframe        https://supervisor.<root>    the supervisor
│        ├── your plugin (wasm)
│        ├── other apps' plugins (wasm)        one instance each, separate memories
│        └── host plugins: http, db, auth, crypto, prompt, transact
Node
├── myapp       the service        (inside transactions)
└── myapp+1     the query service  (inside HTTP requests)
```

All plugins run inside the supervisor's frame, on the supervisor's address. That is what lets one plugin call another directly, and what keeps the user's keys and session token out of every app's page. The supervisor knows which app is calling from the address of the page that sent the message; a plugin cannot claim to be another.

## A. Every plugin call

```
App page                                   Supervisor
────────                                   ──────────
supervisor.functionCall(
  {service, intf, method, params})
        │ postMessage
        ▼
                                           wait for any call in progress (one at a time,
                                             across all tabs)
                                           load and instantiate the plugins this call needs
                                           transact: start-tx
                                           your plugin's function(params)
                                           transact: finish-tx   → sends the transaction,
                                                                   if any action was added
                                           discard the plugin instances
        ◄──────────────────────────────── postMessage: the function's result, or an error
```

Consequences:

- **Calls do not overlap.** A second call waits for the first.
- **Plugin memory does not survive the call.**
- **The page gets only the function's return value**, never the transaction or its trace.

## B. A read

```
your plugin ─► host::server::post_graphql_get_json(query)
            ─► POST https://myapp.<root>/graphql        the plugin's own service, always
                 Authorization: Bearer <the user's session token>
Node        ─► myapp+1 serveSys(request, socket, user)
            ─► GraphQL query runs against the tables
            ◄─ JSON
your plugin ─► serde structs ─► typed result ─► page
```

From the page, the same read is `graphqlAuth(myapp.authorized.graphql, query)`: flow A carrying this flow inside it.

## C. A write

```
your plugin ─► myapp::Wrapper::add_to_tx().create(name)     packs the arguments; nothing is sent
   … the function returns …
finish-tx   ─► the user's auth service plugin supplies the claim and signs
            ─► POST https://transact.<root>/push_transaction     binary
            ◄─ replies when the transaction is final
page        ◄─ the function's result, or the error that stopped the transaction
```

- Actions added by every plugin involved in the call go into **one** transaction, in the order they were added.
- If the transaction fails, the page's promise rejects. Nothing was applied.
- After success the page invalidates the queries the write affects and reads again.

## D. One plugin calling another

```
your plugin ─► tokens::plugin::helpers::get_user_balances(user)
                    │ a direct call inside the supervisor; no message, no network
                    ▼
               Tokens plugin: checks the caller against its trust rule, then runs
```

The called plugin sees who called it (`get_sender`) and which app the user is on. Arguments and results are copied between the two plugins' memories; they share nothing.

## E. Asking the user

```
a plugin    ─► host:prompt (or a trust check that needs the user's consent)
supervisor  ─► abandons the call: no result, no transaction
page        ◄─ told to show the prompt; the browser goes to the supervisor's prompt page
user        ─► decides; the browser returns to the app
page        ─► the user repeats the action; this time the trust check passes
```

A call is never resumed after a prompt. Write UIs so that repeating the action is the obvious next step.

## Worked example: another app's balances

An exchange wants to show the user's wallet balances, which belong to the Tokens app.

```
Exchange page
  └─► exchange plugin: balances()                                         flow A
        └─► tokens plugin: helpers.get-user-balances(user)                flow D
              │  trust: High, with a whitelist. The exchange is not on it:
              │  the first time, the user is asked (flow E) and repeats.
              └─► POST https://tokens.<root>/graphql  + the user's token  flow B
                    └─► tokens+1: is the token's user the user asked about? then read
              ◄── JSON ─► list<user-balance>
        ◄── typed list
  ◄── what the exchange's own function returns
```

The exchange page could not have made that request itself. It has no session token: the token is in the supervisor, and the page's own session cookie is unreadable to script and is not sent to another service's address. A request without a user is refused by the query. This is deliberate. It puts the Tokens plugin between every other app and the user's balances, so the user's consent, and whatever narrowing Tokens chooses to apply, happen in the user's browser.

## Where this is going: asynchronous calls

Today everything between `start-tx` and `finish-tx` is synchronous. A plugin's network request blocks the supervisor until it returns, storage is limited to what the browser offers synchronously, and a plugin cannot wait for anything.

The planned change ([#2177](https://github.com/gofractally/psibase/pull/2177)) lets the browser suspend a plugin while a request is in flight. It is built so that plugin authors change nothing:

| | Stays the same | Changes |
|---|---|---|
| Plugin source | Written as straight-line calls, as now. No `async` in Rust or WIT. | |
| Calls | One at a time. One call, one transaction. | The supervisor is no longer blocked while a call waits on the network. |
| State | Plugins are stateless; state goes in plugin storage. | Storage moves to a larger, more durable store. |
| Browsers | | Where the browser lacks the feature, the current synchronous path is used. |

Write plugins to the rules in the [guide](README.md#rules-that-hold-everywhere) and they are correct on both paths. In particular: **do not rely on anything in plugin memory outliving a call, and do not assume a call returns quickly.**

Not part of that change, and not to be assumed: several requests in flight inside one call, several calls at once, and prompts that return to the plugin.

## Known limits

These are properties of the current read path. Design with them in mind; do not work around them inside one app.

- **Reads are text.** A query is GraphQL text, parsed in wasm on the node; the answer is JSON, produced in wasm on the node and parsed again in the plugin. Writes are binary.
- **Each read is its own request.** There is no connection shared across services, and requests inside a call run one after another.
- **Nothing is pushed.** The node does not tell a page that state changed. A UI refetches after its own writes and otherwise polls. Keep polling intervals long and queries small.
- **A permission prompt costs the call.**
