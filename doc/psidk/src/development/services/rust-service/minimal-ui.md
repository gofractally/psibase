# Minimal User Interface (Rust)

The psibase library can provide a minimal UI to your services. This UI can help get you started developing your own services, but isn't suitable for end users.

## example-ui

Run the following to create a project:

```
cargo new --lib example-ui
cd example-ui
cargo add psibase
cargo add -F derive serde
```

Replace the content of `lib.rs` with the following:

```rust
#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use psibase::*;

    #[action]
    fn add(a: i32, b: i32) -> i32 {
        a + b
    }

    #[action]
    fn multiply(a: i32, b: i32) -> i32 {
        a * b
    }

    // This action serves HTTP requests
    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        // serve_simple_ui serves UI files to the browser and
        // provides an RPC interface for preparing transactions.
        // #[psibase::service] automatically generates Wrapper.
        serve_simple_ui::<Wrapper>(&request)
    }
}
```

## Building and Deploying

The `--register-proxy` option (shortcut `-p`) registers the service with the [`proxy-sys` service](../default-apps/proxy-sys.md). Registered services may:

- Optionally serve files via HTTP
- Optionally respond to RPC requests
- Optionally respond to GraphQL requests

[`proxy-sys`](../../default-apps/proxy-sys.md) calls into the service's `serveSys` action. See [Calling Other Services](calling.md) to see how services do this.

This will build the service and deploy it to the chain:

```sh
cargo psibase deploy -ip example-ui
```

## Trying the UI

If you're running a test chain locally, then it will typically be at [http://psibase.127.0.0.1.sslip.io:8080/](http://psibase.127.0.0.1.sslip.io:8080/). If this is the case, then prefix the domain with the service name: [http://example-ui.psibase.127.0.0.1.sslip.io:8080/](http://example-ui.psibase.127.0.0.1.sslip.io:8080/).

## Sys Suffix

There are 2 common suffixes used by psibase services:

- Trusted system services have account names which end with `-sys`. Only chain operators may create accounts with this suffix.
- psibase standard action names end with `Sys` or `_Sys` (case insensitive); `serveSys` is one of these actions. You should avoid this suffix when defining your own actions if they're not implementing one of the [existing standards](../../standards/actions.html) documented in this book. If you don't avoid it, your service may misbehave when future standards are adopted. e.g. don't create an action named `emphasys`.

## How it Works

- psinode forwards most http requests to the [`proxy-sys` service](../../default-apps/proxy-sys.md).
- If the URL begins with `/common`, [`proxy-sys`](../../default-apps/proxy-sys.md) forwards the request to the [`common-sys` service](../../default-apps/common-sys.md). [`common-sys`](../../default-apps/common-sys.md) provides shared resources, such as js library code and an RPC request handler for packing transactions.
- [`proxy-sys`](../../default-apps/proxy-sys.md) looks at the request domain. If it begins with the name of a registered service, it calls that service's `serveSys` action to process the request.
- [psibase::serve_simple_ui](https://docs.rs/psibase/latest/psibase/fn.serve_simple_ui.html) handles the following requests:
  - `GET /` returns a minimal html file which references the `/common/SimpleUI.mjs` script. This script generates the UI dynamically.
  - `GET /action_templates` returns a template json structure (below). This lets the UI know which actions are available and sample values for their arguments. This isn't a schema; it's only suitable for simple cases.
  - `GET /schema` returns the service's [schema](../../format/schema.md).
  - `POST /pack_action/add` accepts the arguments for the `add` action as a JSON object, converts it to binary, and returns the result.

For more detail, see [Web Services](reference/web-services.html).

### `/action_templates` result

```json
{
  "add": {
    "a": 0,
    "b": 0
  },
  "multiply": {
    "a": 0,
    "b": 0
  },
  "serveSys": { ... }
}
```
