# psibase_plugin

Rust SDK crate for building psibase plugins that compile to wasm components.

Provides ergonomic Rust wrappers around the WIT host imports defined in the `plugin-imports` world, plus higher-level helpers (transaction building, permissions/trust, typed GraphQL, error conversion).

Simplifies things for plugin authors that can now add a single crate dep instead of linking to a bunch of different core plugins.
