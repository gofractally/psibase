# Local Services

Psibase supports services that are defined on each node. Local services can handle HTTP requests but are not available in transactions, because they do not behave consistently across the whole network.

Local services are used for several purposes:
- Services provided by the node operator. For example, a service to process non-crypto payments made to the node operator.
- Services for use by node operators. Such services often require privileges that should not be exposed to regular on-chain services.
- Services that abstract functionality from the host. These services are tightly coupled to `psinode`.

## Writing a Local Service

Local services can be built using all the same tools as on-chain services.

### Database

Local services can store data in subjective databases. The `subjective` database is persistent. The `session` database persists until the node is stopped or restarted. Subjective databases can be accessed concurrently and all accesses must be inside a subjective transaction to ensure consistency.

{{#tabs}}
{{#tab name="Rust"}}
```rust
subjective_tx! {
    table.put(MyRow{ value: 42 })
}
```
{{#endtab}}
{{#tab name="C++"}}
```c++
PSIBASE_SUBJECTIVE_TX
{
    table.put(MyRow{ .value = 42 });
}
```
{{#endtab}}
{{#endtabs}}

Subjective transactions can be nested and changes to the database are committed at the end of the outermost one.

> Important: The commit may fail if the database was changed concurrently. When this happens, the body of the subjective tx will run again automatically. The state of the database will be reset first, but any changes to variables in memory will remain. Be especially careful about inserting into a container or conditionally setting a variable inside a subjective transaction.

> Important: An early exit from the subjective tx will abort it, discarding any database changes

The `session` database should be used for data that is linked to a socket, because sockets have session lifetime. Most other data should be stored in the `subjective` database.

### Authentication

If an endpoint is authenticated, we first need to check that the caller is `x-http` to prevent other services from forging authentication. Then we can ask `x-admin` whether the request comes from a node administrator. `x-admin::checkAuth` returns an appropriate error response if the request is *not* authorized. `x-admin` determines this using a combination of request headers and the client's connection.

The authorization check can be put at the top level to authenticate all requests including for static content in `x-sites` or it can be put in the handler for a specific endpoint if the service provides a mix of public and authenticated endpoints.

{{#tabs}}
{{#tab name="Rust"}}
```rust
#[action]
fn serveSys(request: HttpRequest, socket: Option<i32>) -> Option<HttpReply> {
    assert!(get_sender() == x_http::SERVICE);
    if let Some(reply) = x_admin::Wrapper::call().checkAuth(request.clone(), socket) {
        return Some(reply)
    }
    ...
}
```
{{#endtab}}
{{#tab name="C++"}}
```c++
auto serveSys(HttpRequest request, std::optional<i32> socket)
    -> std::optional<HttpReply>
{
    check(getSender() == XHttp::service, "Wrong sender");
    if (auto reply = to<XAdmin>().checkAuth(request, socket))
    {
        return reply;
    }
    ...
}
```
{{#endtab}}
{{#endtabs}}

### HTTP Requests

Local services can make arbitrary HTTP requests. The request is sent to the remote host with minimal processing. The response will be passed to a callback when it is received.

{{#tabs}}
{{#tab name="Rust"}}
```rust
let socket = x_http::Wrapper::call().sendRequest(
    HttpRequest{
        host: "example.com".to_string(),
        method: "GET".to_string(),
        target: "https://example.com/".to_string(),
        contentType: Default::default(),
        body: Default::default(),
    },
    None,
    None,
);
subjective_tx! {
    x_http::Wrapper::call().setCallback(socket,
        method!("succeeded"), method!("failed"));
    // Add socket to a table so we know what to do
    // with the response
}

...
#[action]
fn succeeded(socket: i32, reply: HttpReply) {}
#[action]
fn failed(socket: i32) {}
```
{{#endtab}}
{{#tab name="C++"}}
```c++
std::int32_t socket = to<XHttp>().sendRequest(
    HttpRequest{
        .method = "GET",
        .target = "https://example.com/"
    },
    std::nullopt, std::nullopt
);
PSIBASE_SUBJECTIVE_TX
{
    to<XHttp>().setCallback(socket,
        MethodNumber{"succeeded"}, MethodNumber{"failed"});
    // Add socket to a table so we know what to do
    // with the response
}

...
void succeeded(std::int32_t socket, HttpReply reply);
void failed(std::int32_t socket);
```
{{#endtab}}
{{#endtabs}}

> Note: `sendRequest` does not resolve redirects

> Note: If the response returns a 4xx or 5xx status code, it will still be passed to the success callback, not the failure callback. The failure callback is used if connecting to the remote host fails of if the connection is closed without a complete response.


{{#tabs}}
{{#tab name="Rust"}}
```rust
let socket = x_http::Wrapper::call().websocket(
    HttpRequest{
        host: "websocket.example.com".to_string(),
        method: "GET".to_string(),
        target: "https://websocket.example.com/".to_string(),
        contentType: Default::default(),
        body: Default::default(),
    },
    None,
    None,
);
subjective_tx! {
    x_http::Wrapper::call().setCallback(socket,
        method!("connected"), method!("failed"));
    // Add socket to a table so we know what to do with the
    // messages we receive
}

...
#[action]
fn connected(socket: i32, reply: HttpReply) {
    assert!(get_sender() == x_http::SERVICE);
    x_http::Wrapper::call().setCallback(socket,
        method!("recv"), method!("close"));
}
#[action]
fn recv(socket: i32, msg: Vec<u8>) {}
#[action]
fn failed(socket: i32, reply: Option<HttpReply>) {}
#[action]
fn close(socket: i32) {}
```
{{#endtab}}
{{#tab name="C++"}}
```c++
std::int32_t socket = to<XHttp>().websocket(
    HttpRequest{
        .method = "GET",
        .target = "https://websocket.example.com/"
    },
    std::nullopt, std::nullopt
);
PSIBASE_SUBJECTIVE_TX
{
    to<XHttp>().setCallback(socket,
        MethodNumber{"connected"}, MethodNumber{"failed"});
    // Add socket to a table so we know what to do with the
    // messages we receive
}

...
void connected(std::int32_t socket, HttpReply reply)
{
    check(getSender() == XHttp::service, "Wrong sender");
    to<XHttp>().setCallback(socket,
        MethodNumber{"recv"}, MethodNumber{"close"});
}
void recv(std::int32_t socket, std::vector<char> msg);
void failed(std::int32_t socket, std::optional<HttpReply> reply);
void close(std::int32_t socket);
```
{{#endtab}}
{{#endtabs}}

For websockets, the success callback is only run if the remote host completes the websocket handshake. After a successful connection, messages will be sent to the recv callback until the connection is closed. The close callback will be run if the remote end closes the connection, but not if the service explicitly closes it with `x-http::close`.

### Naming

Local services should have names that begins with `x-`, to avoid conflicts with on-chain services. The standard `accounts` service reserves these names for local services.

## Installing

### Initialization

`psinode` installs a default set of local packages when it creates a new database directory.

### Web

The `x-admin` panel provides a Packages tab for managing local packages.

### CLI

Most package commands in [psibase](../../run-infrastructure/cli/psibase.md) take a `--local` flag to manage local packages instead of on-chain packages.
