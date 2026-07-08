# sites

The `sites` service is used to host content for an account and serve it over HTTP to the account's subdomain.

# Service docs

{{#cpp-doc ::SystemService::Sites}}

# Additional design notes

## CSP header baseline

The `Content-Security-Policy` header aids security efforts, as modern browsers restrict the capabilities of the document on the client-side according to the policy expressed in this header. The sites server uses a strict baseline CSP header; apps with additional requirements (e.g. the supervisor, prompt pages, or sites built with tooling that emits inline scripts) override it with the `setCsp` action.

Host sources are written scheme-relative (no `http://`/`https://` prefix), so the same policy works over `http` in local development and `https` in production. The root host is currently hardcoded to `psibase.localhost:8080`; deriving it per request is planned as separate work.

| Default policy    | Values                                                       |
| ----------------- | ------------------------------------------------------------ |
| `default-src`     | `'self'`                                                     |
| `script-src`      | `'self'`                                                     |
| `style-src`       | `'self' 'unsafe-inline'`                                     |
| `img-src`         | `'self' data: psibase.localhost:8080 *.psibase.localhost:8080` |
| `font-src`        | `'self'`                                                     |
| `connect-src`     | `'self' psibase.localhost:8080 *.psibase.localhost:8080`     |
| `frame-src`       | `supervisor.psibase.localhost:8080`                          |
| `frame-ancestors` | `'self'`                                                     |
| `base-uri`        | `'none'`                                                     |
| `form-action`     | `'self'`                                                     |
| `object-src`      | `'none'`                                                     |

Notable consequences of the strict baseline:

- Inline `<script>` tags, `eval`, and CDN-hosted scripts are blocked by default. Apps that need them must opt in via `setCsp`.
- Pages may only be embedded same-origin by default (`frame-ancestors 'self'`). Pages designed to be embedded by the supervisor (e.g. plugin prompt pages) must widen `frame-ancestors` to include the supervisor's origin.
- The only frameable origin is the supervisor (every app embeds the hidden supervisor iframe).
- Cross-subdomain `fetch`/WebSocket and image loads within the deployment's domain are allowed; arbitrary external origins are not.

### Dynamic CSP

If the baseline CSP is insufficient, the `sites` service allows users to customize the header for their entire site or for a specific path using the `setCsp` action.

The priority of the CSP header applied to content is given to a header set for a specific path, then the header set for an entire site, and finally will default to the default policy if no custom headers were provided.

Note that a custom CSP **completely replaces** the baseline for the content it covers — the policies are not merged — so a custom CSP should be stated as a complete policy.

## HTTP caching

On upload, the `sites` server calculates and stores a hash of the content at each path. The server now returns the hash in an [`etag`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag) header, as well as setting the `cache-control` header to `no-cache`.

This cache policy tells the browser to add, on any subsequent requests for the same content, an `If-None-Match` header with the previously sent ETag value. The server then has a chance to respond with `304 Unmodified`, allowing the browser to use its cached value for the asset, rather than initiating a fresh transfer.

This helps reduce the load on the server and speeds up subsequent page loads.

## Compression

Uploading assets to a psibase network using the the psibase CLI will automatically apply [Brotli](https://en.wikipedia.org/wiki/Brotli) compression to content of a supported mime type.

Automatically compressed types:

- text/plain
- text/html
- text/css
- application/javascript
- application/json
- application/xml
- application/rss+xml
- application/atom+xml
- image/svg+xml
- font/ttf
- font/otf
- application/wasm

Compression level can be specified in every CLI where it makes sense:

- `psibase boot -z <LEVEL>`
- `psibase upload -z <LEVEL>`
- `psibase install -z <LEVEL>`
- `cargo psibase install -z <LEVEL>`

The compression level ranges from 1-11, where 1 is the fastest and 11 is the best compression. The default value is 4.

### Fallback decompression

If the client uses the `Accept-Encoding` HTTP request header to indicate that it does not support the encoding type of the requested content, and the server knows how to decompress the content, then the server will automatically decompress the content before serving it to the client.

The only encoding type that currently supports fallback decompression is Brotli.
