# Web Services

- [Routing](#routing)
- [Registration](#registration)
- [psibase::ServerInterface]
- [psibase::ServerUploadInterface]
- [psibase::RpcRequestData]
- [psibase::RpcReplyData]

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
 /                \  no    / domain begins    \
/  target begins   \ ---> /  with a registered \
\  with "/common?" /      \  contract name?    /
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

`psinode` passes most HTTP requests to the `proxy-sys` contract. It then routes requests to the appropriate contract's `serveSys` action (see diagram). The contracts run in RPC mode. This prevents them from writing to the database, but allows them to read data they normally can't; see [psibase::DbId].

`serveSys` can do any of the following:

- Return `std::nullopt` to signal not found. psinode produces a 404 response in this case.
- Abort. psinode produces a 500 response with the contract's abort message.
- Return a [psibase::RpcReplyData]. psinode produces a 200 response with the body and contentType returned.

## Registration

Contracts which wish to serve HTTP requests need to register using the `proxy-sys` contract's `registerServer` action. Contracts may register themselves, e.g. during an initialization action, or may be registered manually.

- `psibase install` has a `--register-proxy` option (shortcut `-p`) that can do this while installing the contract
- `psibase register-proxy` can also do it. TODO: implement `psibase register-proxy`.

A contract doesn't have to serve HTTP requests itself; it may delegate this to another contract during registration.

{{#cpp-doc ::psibase::ServerInterface}}
{{#cpp-doc ::psibase::ServerUploadInterface}}
{{#cpp-doc ::psibase::RpcRequestData}}
{{#cpp-doc ::psibase::RpcReplyData}}
