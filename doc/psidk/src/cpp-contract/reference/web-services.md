# Web Services

- [Routing](#routing)
- [Registration](#registration)
- [Interfaces](#interfaces)
  - [psibase::ServerInterface]
  - [psibase::RpcRequestData]
  - [psibase::RpcReplyData]
  - [psibase::StorageInterface]

## Routing

```svgbob
+---------+      +---------+      +-----------+
| HTTP    |      |         |      | proxy-sys |
| Request | ---> | psinode | ---> | contract  |
|         |      |         |      |           |
+---------+      +---------+      +-----------+
                                       |
         +-----------------------------+
         |
         v
  +--------------+          +----------------+
 /                \  no    /                  \
/  target begins   \ ---> /  on a subdomain?   \
\  with "/common?" /      \                    /
 \                /        \                  /
  +--------------+          +----------------+
         | yes                no |      | yes
         |        +--------------+      |
         |        |                     |
         v        v                     v
      +-----------------+       +------------------+
      | common-sys      |       | registered       |
      | contract's      |       | contract's       |
      | serveSys action |       | serveSys action  |
      +-----------------+       +------------------+
```

`psinode` passes most HTTP requests to the [psibase::proxy_sys] contract, which then routes requests to the appropriate contract's [serveSys](#psibaseserverinterfaceservesys) action (see diagram). The contracts run in RPC mode; this prevents them from writing to the database, but allows them to read data they normally can't. See [psibase::DbId].

[psibase::common_sys] provides services common to all domains under the `/common` tree. It also serves the chain's main page.

`psinode` directly handles requests which start with `/native`, e.g. `/native/push_transaction`. Contracts don't serve these.

## Registration

Contracts which wish to serve HTTP requests need to register using the [psibase::proxy_sys] contract's [psibase::proxy_sys::registerServer] action. There are multiple ways to do this:

- `psibase install` has a `--register-proxy` option (shortcut `-p`) that can do this while installing the contract.
- `psibase register-proxy` can also do it. TODO: implement `psibase register-proxy`.
- A contract may call `registerServer` during its own initialization action.

A contract doesn't have to serve HTTP requests itself; it may delegate this to another contract during registration.

## Interfaces

Contracts which serve HTML implement these interfaces:

- [psibase::ServerInterface] (required)
  - [psibase::RpcRequestData]
  - [psibase::RpcReplyData]
- [psibase::StorageInterface] (optional)

{{#cpp-doc ::psibase::ServerInterface}}
{{#cpp-doc ::psibase::RpcRequestData}}
{{#cpp-doc ::psibase::RpcReplyData}}
{{#cpp-doc ::psibase::StorageInterface}}
