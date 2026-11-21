# Current Invite service pair

These artifacts compile the unmodified current upstream Invite and RInvite
sources with the local macOS WASI SDK and released platform-independent
WASM libraries. Current Invite init calls `nft.setAutoDebit(false)` instead
of the removed NFT `setUserConf` action.

Artifacts:

* `Invite.wasm`, `Invite-schema.json`
* `RInvite.wasm`, `RInvite-schema.json`

Both schema generator modules ran successfully under current `build/psitest`.
The service link follows the upstream Invite CMake dependency structure:
Spki/Botan, the normal Psibase exception-abort stub, and a 32 KiB stack. No
Invite source, token logic, or authorization checks are patched.

Rebuild from the repository root:

```sh
python3 demo/invite-build/build.py
python3 demo/invite-build/build.py RInvite
```
