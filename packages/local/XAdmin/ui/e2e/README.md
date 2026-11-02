# XAdmin Playwright suite (handoff)

Owns UI paths that Python does not cover. Repo-root `e2e/` stays Playwright
setup only. Add `@playwright/test` + `bcryptjs` (or reuse root `e2e/`) before
running.

## Scope

1. **Boot via Create network** (Development now; Private/Production once SoftHSM
   is wired into the psinode fixture).
2. **Peers join and sync** through Join network + Peers page.
3. **Other producers join and sync** (same UI path, nodes started with `-p`;
   still to write).

CLI package boots (`ProdDefault` / `PrivDefault` with `--account-key`) and
CFT/BFT stay in Python (`test_boot_prod_default` / `test_boot_priv_default`,
SoftHSM keyed boot, crash/connect suites) — not Playwright.

| Spec | Status |
| --- | --- |
| `create-boot.spec.ts` | Dev create wizard; Priv skipped until SoftHSM |
| `peering-journey.spec.ts` | UI create (Dev) then two joiners via Join UI |
| producer-join (TBD) | Additional producers join + sync via UI |
