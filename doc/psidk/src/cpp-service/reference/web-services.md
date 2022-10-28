# Web Services

- [Routing](#routing)
- [Registration](#registration)
- [Interfaces](#interfaces)
  - [psibase::ServerInterface]
  - [psibase::HttpRequest]
  - [psibase::HttpReply]
  - [psibase::StorageInterface]
- [Helpers](#helpers)
  - [psibase::serveSimpleUI]
  - [psibase::serveActionTemplates]
  - [psibase::servePackAction]
  - [psibase::WebContentRow]
  - [psibase::storeContent]
  - [psibase::serveContent]
  - [psibase::serveGraphQL]
  - [psibase::makeConnection]
    - [psibase::PageInfo]
    - [psibase::Edge]
    - [psibase::Connection]
  - [psibase::EventDecoder]
  - [psibase::EventQuery]
  - [psibase::makeEventConnection]
  - [psibase::historyQuery]
  - [psibase::QueryableService]

## Routing

```svgbob
+-----------+      +---------+      +---------+
| proxy-sys |      |         |      | HTTP    |
| service   |<---- | psinode |<---- | Request |
|           |      |         |      |         |
+-----------+      +---------+      +---------+
         |
         |
         v
  +--------------+           +-----------------+
 /                \  yes     | common-sys      |
/  target begins   \ ------> | service's       |
\  with "/common?" /         | serveSys action |
 \                /          +-----------------+
  +--------------+                    ^
         | no                         |
         |                +-----------+
         v                |
  +----------------+      |  +-----------------+
 /                  \  no |  | psispace-sys    |
/  on a subdomain?   \ ---+  | service's       |
\                    /       | serveSys action |
 \                  /        +-----------------+
  +----------------+                  ^
         | yes                        |
         |           +----------------+
         v           |
  +------------+  no |       +-----------------+
 /              \ ---+       | registered      |
/  registered?   \           | service's       |
\                / yes   +-->| serveSys action |
 \              / -------+   +-----------------+
  +------------+
```

`psinode` passes most HTTP requests to the [SystemService::ProxySys] service, which then routes requests to the appropriate service's [serveSys](#psibaseserverinterfaceservesys) action (see diagram). The services run in RPC mode; this prevents them from writing to the database, but allows them to read data they normally can't. See [psibase::DbId].

[SystemService::CommonSys] provides services common to all domains under the `/common` tree. It also serves the chain's main page.

[SystemService::PsiSpaceSys] provides web hosting to non-service accounts.

`psinode` directly handles requests which start with `/native`, e.g. `/native/push_transaction`. Services don't serve these.

## Registration

Services which wish to serve HTTP requests need to register using the [SystemService::ProxySys] service's [SystemService::ProxySys::registerServer] action. There are multiple ways to do this:

- `psibase deploy` has a `--register-proxy` option (shortcut `-p`) that can do this while deploying the service.
- `psibase register-proxy` can also do it. TODO: implement `psibase register-proxy`.
- A service may call `registerServer` during its own initialization action.

A service doesn't have to serve HTTP requests itself; it may delegate this to another service during registration.

## Interfaces

Services which serve HTTP implement these interfaces:

- [psibase::ServerInterface] (required)
  - [psibase::HttpRequest]
  - [psibase::HttpReply]
- [psibase::StorageInterface] (optional)

{{#cpp-doc ::psibase::ServerInterface}}
{{#cpp-doc ::psibase::HttpRequest}}
{{#cpp-doc ::psibase::HttpReply}}
{{#cpp-doc ::psibase::StorageInterface}}

## Helpers

These help implement basic functionality:

- [psibase::serveSimpleUI]
- [psibase::serveActionTemplates]
- [psibase::servePackAction]
- [psibase::WebContentRow]
- [psibase::storeContent]
- [psibase::serveContent]
- [psibase::serveGraphQL]
- [psibase::makeConnection]
  - [psibase::PageInfo]
  - [psibase::Edge]
  - [psibase::Connection]
- [psibase::EventDecoder]
- [psibase::EventQuery]
- [psibase::makeEventConnection]
- [psibase::historyQuery]
- [psibase::QueryableService]

Here's a common pattern for using these functions:

```c++
std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request)
{
   if (auto result = psibase::serveActionTemplates<ExampleService>(request))
      return result;

   if (auto result = psibase::servePackAction<ExampleService>(request))
      return result;

   if (request.method == "GET" && request.target == "/")
   {
      static const char helloWorld[] = "Hello World";
      return psibase::HttpReply{
            .contentType = "text/plain",
            .body        = {helloWorld, helloWorld + strlen(helloWorld)},
      };
   }

   return std::nullopt;
}
```

{{#cpp-doc ::psibase::serveSimpleUI}}
{{#cpp-doc ::psibase::serveActionTemplates}}
{{#cpp-doc ::psibase::servePackAction}}
{{#cpp-doc ::psibase::WebContentRow}}
{{#cpp-doc ::psibase::storeContent}}
{{#cpp-doc ::psibase::serveContent}}
{{#cpp-doc ::psibase::serveGraphQL}}
{{#cpp-doc ::psibase::makeConnection}}
{{#cpp-doc ::psibase::PageInfo}}
{{#cpp-doc ::psibase::Edge}}
{{#cpp-doc ::psibase::Connection}}
{{#cpp-doc ::psibase::EventDecoder}}
{{#cpp-doc ::psibase::EventQuery}}
{{#cpp-doc ::psibase::makeEventConnection}}
{{#cpp-doc ::psibase::historyQuery}}
{{#cpp-doc ::psibase::QueryableService}}
