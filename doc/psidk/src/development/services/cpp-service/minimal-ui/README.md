# Minimal User Interface (C++)

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

This will deploy the service to the chain:

```sh
psibase deploy -ip example example.wasm
```

The `-p` option will register the service with the [`http-server` service](../../../../default-apps/http-server.md). This allows the service to handle web requests. See the [`registerServer`](../../../../default-apps/http-server.md#systemserviceproxysysregisterserver) docs for more details.

## Trying the service

If you're running a test chain locally, then it will typically be at `http://psibase.127.0.0.1.sslip.io:8080/` or `http://psibase.127.0.0.1.sslip.io:8079/`. To try the service, prefix your host with your service name (e.g. `http://example.psibase.127.0.0.1.sslip.io:8080/`).

## How it works

- psinode forwards most http requests to the [`http-server` service](../../../../default-apps/http-server.md).
- If the URL begins with `/common`, [`http-server`](../../../../default-apps/http-server.md) forwards the request to the [`common-api` service](../../../../default-apps/common-api.md). [`common-api`](../../../../default-apps/common-api.md) provides shared resources, such as js library code and an RPC request handler for packing transactions.
- [`http-server`](../../../../default-apps/http-server.md) looks at the request domain. If it begins with the name of a registered service, it calls that service's `serveSys` action to process the request.
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
