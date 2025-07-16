# Front-end development guides

## Outline

A more in depth guide will be added later, but this is a rough outline of the steps required to host your app front-end:

1. Create a psibase account
2. Create a psibase package including a service, [plugin](../../specifications/app-architecture/plugins.md), and UI
3. Install the package to your subdomain
4. [Optional] Register an http server that implements the [psibase::ServerInterface] to handle custom RPC/REST/GraphQl queries.

## Virtual hosting

Psibase infrastructure nodes provide virtual hosting. 

For example, for a local node being hosted at the default domain (`psibase.localhost`), domains fall into two categories:

| Category       | Example                        | Description                                                                     |
|----------------|--------------------------------|---------------------------------------------------------------------------------|
| root domain    | `psibase.localhost`            | Hosts the main page for the network and provides service-independent endpoints. |
| service domain | `my-service.psibase.localhost` | This hosts user interfaces and RPC endpoints for individual services.           |

Many endpoints are available by default at these domains, and services may even define and handle their own endpoints at service domains. To learn more about standard endpoints and defining custom endpoints, see the [http requests reference docs](./reference/http-requests.md).

Some javascript libraries are available at the [common files endpoints](./reference/http-requests.md#common-files) that can make it easier for your external scripts to interface with psibase networks.
