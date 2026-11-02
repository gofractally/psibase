# XAdmin Playwright suite

Owns UI paths that Python does not cover. Repo-root `e2e/` is the Playwright
harness; this directory is the `@psibase/xadmin-e2e` suite (portaled into the
harness for Yarn PnP).

```bash
cd e2e
yarn test --project=chromium ../packages/local/XAdmin/e2e
```

## Scope

1. **Boot via Create network** (Development and Private; Production TBD).
2. **Peers join and sync** through Join network + Peers page.
3. **Other producers join and sync** (same UI path, nodes started with `-p`;
   still to write).

CLI package boots (`ProdDefault` / `PrivDefault` with `--account-key`) and
CFT/BFT stay in Python (`test_boot_prod_default` / `test_boot_priv_default`,
SoftHSM keyed boot, crash/connect suites) — not Playwright.

Private create-boot needs SoftHSM (`softhsm2-util` on `PATH`, or
`LIBSOFTHSM2` / `E2E_LIBSOFTHSM2`). Optional PIN override: `E2E_SOFTHSM_PIN`.

| Spec | Status |
| --- | --- |
| `create-boot.spec.ts` | Dev + Private (SoftHSM) create wizard |
| `peering-journey.spec.ts` | UI create (Dev) then two joiners via Join UI |
| producer-join (TBD) | Additional producers join + sync via UI |
