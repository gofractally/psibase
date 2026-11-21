# Current CommonApi compatibility build

`build.py` compiles the unmodified current `CommonApi.cpp` and current `Rpc.cpp`
using the same macOS WASI compiler/released platform libraries as the existing
Accounts compatibility build. The release `libpsibase.a` lacks the credentialed
CORS overload required by current CommonApi, so a local copy of that archive
has only `Rpc.cpp.obj` removed and is linked with the complete current source.
No duplicate-symbol override, source authorization patch, or library in the SDK
or release directory is changed.

The generated schema comes from running the current schema-generation WASM in
the native `psitest` runner. Both service and schema modules pass `wasm-tools
validate`. Source/artifact hashes and the exact compile command are recorded in
`provenance.json` and `compile-command.json`.

The local demo deployment updates only `common-api`'s service code and generated
schema through the native CLI; it runs no initialization or proxy registration
and does not alter account authentication, service flags or financial services.
Its native transaction trace is `deploy-trace.json`.

`verify.py` uses a disposable, immediately expired probe cookie. Twelve native
endpoint checks pass: Supervisor-origin POST/OPTIONS have exact credentialed
CORS; foreign origins receive no allow-origin/allow-credentials; invalid cookie
names/values/lifetimes and non-JSON content are rejected; existing chain-id,
TaPoS, service-name and root-domain routes still return 200. Raw curl/HTTP
foreign-origin POST is not treated as a browser authorization test: the browser
must enforce the rejected JSON preflight. Browser login/transfer validation is
separate from these native HTTP checks.
