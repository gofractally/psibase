# x-http

The `x-http` service manages all incoming and outgoing HTTP requests and some special sockets. This service is for node operators and local services. Regular services should interact with [http-server](http-server.md) instead of calling `x-http` directly.

## HTTP Endpoints

| Method | URL                | Description                                                 |
|--------|--------------------|-------------------------------------------------------------|
| `POST` | `/register_server` | Registers a service to handle HTTP requests for a subdomain |

### register_server

Registers a service to handle HTTP requests for a subdomain

Requests sent to the subdomain will be forwarded to the `serveSys` action of the subdomain's registered `server`. If no server is registered or if the server does not handle the request, the  request will be handled by `http-server`, unless the subdomain is for a local service, in which case it will be handled by `x-sites`.

`http-server` also allows registration of servers. Registration in `http-server` is network-wide and is controlled by the account owner. Registration in `x-http` is local to a single node and is controlled by the node operator. A server registered in `x-http` will be tried before the one registered in `http-server`.

| Field     | Type   | Description                            |
|-----------|--------|----------------------------------------|
| `service` | String | The subdomain                          |
| `server`  | String | The service that handles HTTP requests |

Example:
```json
{
    "service": "x-peers",
    "server": "x-peers"
}
```

## Actions

{{#cpp-doc ::LocalService::XHttp}}
