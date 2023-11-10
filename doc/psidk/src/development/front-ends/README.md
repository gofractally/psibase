# Front-end development guides

## Outline

A more in depth guide will be added later, but this is a rough outline of the steps required to host your app front-end:

1. Create a psibase account
2. Deploy a service to the account
3. Implement the [psibase::ServerInterface] and [psibase::StorageInterface]
4. Register the account as a web-server by calling the `registerServer` action on the [proxy-sys](../../default-apps/proxy-sys.md) service. This gives the account a domain name according to the rules specified in the [routing](#virtual-hosting) docs.
5. Develop your user interface, using [HTTP requests](./reference/http-requests.md), [JS libraries](./reference/js-libraries.md) as needed, as well as [app interfaces](../../specifications/app-architecture/app-interfaces.md) to interact with your service or third-party apps.
6. Bundle your front-end if needed and upload it to your service for storage and serving.

## Virtual hosting

Psibase infrastructure nodes provide virtual hosting. 

For example, for a local node being hosted at the default domain (`psibase.127.0.0.1.sslip.io`), domains fall into two categories:

| Category       | Example                                 | Description                                                                     |
| -------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| root domain    | `psibase.127.0.0.1.sslip.io`            | Hosts the main page for the network and provides service-independent endpoints. |
| service domain | `my-service.psibase.127.0.0.1.sslip.io` | This hosts user interfaces and RPC endpoints for individual services.           |

Many endpoints are available by default at these domains, and services may even define and handle their own endpoints at service domains. To learn more about standard endpoints and defining custom endpoints, see the [http requests reference docs](./reference/http-requests.md).

Some javascript libraries are available at the [common files endpoints](./reference/http-requests.md#common-files) that can make it easier for your external scripts to interface with psibase networks.
