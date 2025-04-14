# Minimal User Interface (C++)

psidk can provide a minimal UI to your services. This UI can help get you started developing your own services, but isn't suitable for end users.

Here is the service definition. Place `example.cpp` and `CMakeLists.txt` in an empty folder.

## `example.cpp`

```cpp
{{#include example.cpp}}
```

## CMakeLists.txt

```
{{#include CMakeLists.txt}}
```

The `SERVER` option registers an RPC service to handle HTTP requests. In this simple case, `example` will handle its own requests. See the [`registerServer`](../../../../default-apps/http-server.md#systemservicehttpserverregisterserver) docs for more details.

## Building

This will create `MinimalUI.psi`:

```sh
mkdir build
cd build
cmake `psidk-cmake-args` ..
make -j $(nproc)
```

## Deploying the service

This will deploy the service to the chain:

```sh
psibase install ./MinimalUI.psi
```

## Trying the service

If you're running a test chain locally, then it will typically be at `http://psibase.localhost:8080/`. To try the service, prefix your host with your service name (e.g. `http://example.psibase.localhost:8080/`).

## How it works

- psinode forwards most http requests to the [`http-server` service](../../../../default-apps/http-server.md).
- [`http-server`](../../../../default-apps/http-server.md) looks at the request domain. If it begins with the name of a registered service, it calls that service's `serveSys` action to process the request.
- [psibase::serveSimpleUI] handles the following requests:
  - `GET /` returns a minimal html file which loads the javascript to generate the UI.
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
