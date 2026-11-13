# host e2e probe plugins (test only)

Two plugins served under the `host` service so that the Supervisor treats them
as privileged (only service `host` may import `supervisor:bridge`):

- `host:e2e-probe` (`e2e-probe.wasm`): imports `send-request`, so the
  Supervisor compiles it with JSPI. Exports `api` (`fetch-then-prompt`,
  `bucket-across-fetch`, `whoami`) and `res` (resources `lazy-probe`, whose
  method fetches, and `eager-probe`, whose constructor fetches).
- `host:e2e-probe-user` (`e2e-probe-user.wasm`): imports the probe's resources
  through the Supervisor's `addResourceProxy`, so the e2e suite can exercise
  resource proxies whose constructor/method suspends.

They are NOT part of any production build or package: this directory is its
own Cargo workspace (not in `packages/Cargo.toml`), and nothing in
`CMakeLists.txt` references it. Build and add them to a test chain's Host
package:

```bash
cargo +1.88.0 component build -r --target wasm32-wasip1 \
  --manifest-path packages/user/Host/plugin/e2e-probe/Cargo.toml \
  --target-dir <build>/e2e-probe
# then add host_e2e_probe.wasm as data/host/e2e-probe.wasm and
# host_e2e_probe_user.wasm as data/host/e2e-probe-user.wasm in Host.psi
```
