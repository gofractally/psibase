# Latest Accounts bootstrap service

`Accounts.wasm` and `Accounts-schema.json` are compiled from the unmodified
latest upstream `packages/system/Accounts/src/Accounts.cpp` and current
headers. The generated schema exposes `newAccount(name,authService,mode:u8)`
with a bool return, including mode 2 (`requireNew`). This replaces the older
release package's incompatible bool parameter during a current-CLI boot.

`build.py` uses the existing macOS WASI SDK compiler and platform-independent
0.29 release WASM libraries unpacked under `demo/upstream`. It also builds
`Accounts-schema-gen.wasm` and runs that module with the current native
`build/psitest` to produce the schema. No hand-edited schema or byte-patched
service is used.

The additional `-lc` supplies the SDK's single-thread pthread stubs needed by
libc++'s `std::format` / `call_once`, which the latest Accounts source uses.
Committed service code still uses the normal Psibase allocator and WASI
polyfill link libraries. No blockchain runtime or authorization bypass is
introduced by this build adaptation.

Rebuild from the repository root:

```sh
python3 demo/accounts-build/build.py
```
