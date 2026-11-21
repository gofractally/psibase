# Native HTTP gateway security regression

The production gateway now authenticates the original request, then strips all
`Authorization` headers and every issued `__Host-SESSION` cookie before calling
an application RPC. Legacy `__HOST-SESSION` and `SESSION` names remain reserved.
Duplicate cookies, multiple mixed-case Cookie header fields and whitespace
before `=` cannot conceal credentials. Ordinary cookie names retain their
case-sensitive semantics (`session` remains an application cookie).

The generic non-credentialed OPTIONS response explicitly allows Authorization;
the CORS wildcard alone does not cover that request header. Existing public
origin/method behavior is preserved, with no blanket credentialed CORS grant.
CommonApi's Supervisor-only credentialed cookie route remains separate.

`build.py` compiles current HttpServer and its schema with the existing WASI
toolchain. Its local copy of the released psibase archive replaces only Rpc and
HttpHeaders objects with complete current source, supplying current CORS,
cookie and host-port helpers. Original SDK/release libraries are untouched.

Validation includes 15 checks executing the exact production helper in the
native WASM test runner, plus eight live node tests through an actual `serveSys`
probe using a real signed JWT. The probe returns only credential-presence
booleans, the authenticated username and known benign test cookies; bearer
values are never printed or recorded. The native tests verify authentication
survives stripping, all secret instances disappear, ordinary cookies survive,
malformed cookie input fails closed, and public preflight permits Authorization
without credentials. Results are in `verification.json`; source/artifact hashes
are in `provenance.json`.

Three matching Catch2 cases are included in the repository's `test_rpc.cpp` for
the normal complete SDK build. The released Catch2 archive aborts before test
output under this compatibility link, so the focused WASM runner is used here;
the Catch2 cases are not reported as executed by this build.

The local operator deployment changes only `http`'s code and generated schema;
it preserves existing flags, authentication and server registrations. A new
`cookietest` fixture registration is isolated from normal app domains. It does
not replace any financial service. A release backup is retained locally.

The installed legacy RTransact currently accepts `SESSION` cookie authentication
and standard `Bearer` headers; its canonical `__Host-SESSION` cookie-only path
requires a matching current RTransact upgrade. The regression supplies a real
Bearer while testing canonical-cookie secrecy, and separately proves existing
legacy-cookie authentication still works. This compatibility limitation is not
an authentication bypass.

For an already exposed public deployment, stripping future requests does not
invalidate root-audience JWTs previously leaked to app servers. Session/key
rotation is a separate rollout requirement. No JWT-key/authentication changes
are made by this patch.
