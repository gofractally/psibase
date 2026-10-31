# Front-end development guides

## Outline

A more in depth guide will be added later, but this is a rough outline of the steps required to host your app front-end:

1. Create a psibase account
2. Create a psibase package including a service, [query](../../specifications/app-architecture/http-requests.md#query-service), [plugin](../../specifications/app-architecture/plugins.md), and UI
3. Install the package to your subdomain

## Virtual hosting

Psibase infrastructure nodes provide virtual hosting. Every account has a subdomain matching the account name.

For example, for a local node being hosted at the default domain (`psibase.localhost`), `my-service.psibase.localhost` hosts user interfaces and RPC endpoints for `my-service`.

### Safari and local development

Safari cannot do local development against a psibase node; HTTPS on `localhost`
does not fix it.

- Treats each `*.localhost` subdomain as a separate site, so the supervisor iframe cannot read or write cookies (including on HTTPS)
- Rejects `__Host-`/`__Secure-` cookies over plain HTTP

Use another browser for local dev. For Safari, use **production HTTPS** on a
registered domain that is not `localhost`.

Some javascript libraries are available at the [common files endpoints](../../default-apps/common-api.md#common-files) that can make it easier for your external scripts to interface with psibase networks.
