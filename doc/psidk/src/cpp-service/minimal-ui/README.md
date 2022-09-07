# Minimal User Interface

psidk can provide a minimal UI to your services. This UI can help get you started developing your own services, but isn't suitable for end users.

Here is the service definition. Place `example.cpp` and `CMakeLists.txt` in an empty folder.

## `example.cpp`

```cpp
{{#include example.cpp}}
```

## CMakeLists.txt

[CMakeLists.txt](CMakeLists.txt) is the same as the one in [Basic Service](../basic/).

## Building

This will create `example.wasm`:

```sh
mkdir build
cd build
cmake `psidk-cmake-args` ..
make -j $(nproc)
```

## Deploying the service

The `--register-proxy` option (shortcut `-p`) registers the service with the [`proxy-sys` service](../../system-service/proxy-sys.md). Registered services may:

- Optionally serve files via HTTP
- Optionally respond to RPC requests
- Optionally respond to GraphQL requests

[`proxy-sys`](../../system-service/proxy-sys.md) calls into the service's `serveSys` action. See [Calling Other Services](../calling/) to see how services do this.

```sh
psibase deploy -ip example example.wasm
```

## Trying the service

If you're running a test chain locally, then it will typically be at [http://psibase.127.0.0.1.sslip.io:8080/](http://psibase.127.0.0.1.sslip.io:8080/). If this is the case, then prefix the domain with the service name: [http://example.psibase.127.0.0.1.sslip.io:8080/](http://example.psibase.127.0.0.1.sslip.io:8080/).

## Sys suffix

There are 2 common suffixes used by psibase services:

- Trusted system services have account names which end with `-sys`. Only chain operators may create accounts with this suffix.
- psibase standard action names end with `Sys` or `_Sys` (case insensitive); `serveSys` is one of these actions. You should avoid this suffix when defining your own actions if they're not implementing one of the [existing standards](../../standards/actions.html) documented in this book. If you don't avoid it, your service may misbehave when future standards are adopted. e.g. don't create an action named `emphasys`.

## How it works

- psinode forwards most http requests to the [`proxy-sys` service](../../system-service/proxy-sys.md).
- If the URL begins with `/common`, [`proxy-sys`](../../system-service/proxy-sys.md) forwards the request to the [`common-sys` service](../../system-service/common-sys.md). [`common-sys`](../../system-service/common-sys.md) provides shared resources, such as js library code and an RPC request handler for packing transactions.
- [`proxy-sys`](../../system-service/proxy-sys.md) looks at the request domain. If it begins with the name of a registered service, it calls that service's `serveSys` action to process the request.
- [psibase::serveSimpleUI] handles the following requests:
  - `GET /` returns a minimal html file which references the `/common/SimpleUI.mjs` script. This script generates the UI dynamically.
  - `GET /action_templates` returns a template json structure (below). This lets the UI know which actions are available and sample values for their arguments. This isn't a schema; it's only suitable for simple cases.
  - `POST /pack_action/add` accepts the arguments for the `add` action as a JSON object, converts it to binary, and returns the result.

For more detail, see [Web Services](../reference/web-services.html).

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
