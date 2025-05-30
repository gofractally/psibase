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

Add the following to `Cargo.toml`.
```toml
[package.metadata.psibase]
package-name = "ExampleUI"
server = "example-ui"
```

The `server` option registers an RPC service to handle HTTP requests. In this simple case, `example` will handle its own requests. See the [`registerServer`](../../../default-apps/http-server.md#systemservicehttpserverregisterserver) docs for more details.

## Building and Deploying

This will build the service and deploy it to the chain:

```sh
cargo psibase install
```

## Trying the UI

If you're running a test chain locally, then it will typically be at `http://psibase.localhost:8080/`. To try the service, prefix your host with your service name (e.g. `http://example.psibase.localhost:8080/`).

## How it Works

- psinode forwards most http requests to the [`http-server` service](../../../default-apps/http-server.md).
- [`http-server`](../../../default-apps/http-server.md) looks at the request domain. If it begins with the name of a registered service, it calls that service's `serveSys` action to process the request.
- [psibase::serve_simple_ui](https://docs.rs/psibase/latest/psibase/fn.serve_simple_ui.html) handles the following requests:
  - `GET /` returns a minimal html file which loads the javascript to generate the UI.
  - `GET /action_templates` returns a template json structure (below). This lets the UI know which actions are available and sample values for their arguments. This isn't a schema; it's only suitable for simple cases.
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
