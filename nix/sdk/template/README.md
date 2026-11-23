# Out-of-tree package workspace (`packages/`)

Source of truth for the Cargo workspace skeleton used by out-of-tree app
repos (crates.io `psibase` / `psibase_macros`, not monorepo `path =` deps).

```text
packages/
├── Cargo.toml          # workspace + crate pins
└── <App>/              # service, query-service, plugin, ui
```

In-tree apps still use root [`package-templates/`](../../../package-templates/)
into `packages/user/`.
