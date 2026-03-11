// Verifies that the `#[authorized(...)]` macro produces correct compile errors
// for invalid usage and compiles successfully for valid usage.
//
// From crate root (rust/psibase_macros/psibase-macros-derive/),
// Run:  `cargo test --test authorized`
//
// To update .stderr files:
// Run:  `TRYBUILD=overwrite cargo test --test authorized`
//
// See also: https://github.com/dtolnay/trybuild
#[test]
fn authorized_macro() {
    let t = trybuild::TestCases::new();
    // Valid trust levels
    // Invocations:
    // - #[authorized(None)]
    // - #[authorized(Low)]
    // - #[authorized(Medium)]
    // - #[authorized(High)]
    // - #[authorized(Max)]
    t.pass("tests/authorized/valid_trust_levels.rs");

    // Trust level with whitelist
    // Invocations:
    // - #[authorized(Medium, whitelist = ["homepage"])]
    // - #[authorized(High, whitelist = ["homepage", "virtual-server", "invite"])]
    t.pass("tests/authorized/with_whitelist.rs");

    // Result-returning fn (auth check uses ?)
    // Invocations:
    // - #[authorized(Medium)]
    t.pass("tests/authorized/result_return_type.rs");

    // Non-Result fn (auth check uses .unwrap())
    // Invocations:
    // - #[authorized(High)]
    t.pass("tests/authorized/non_result_return_type.rs");

    // Empty whitelist
    // Invocations:
    // - #[authorized(Medium, whitelist = [])]
    t.pass("tests/authorized/empty_whitelist.rs");

    // Result via full path (std::result::Result)
    // Invocations:
    // - #[authorized(Low)]
    t.pass("tests/authorized/result_full_path.rs");

    // Custom error type with From< auth error >
    // Invocations:
    // - #[authorized(Medium)]
    t.pass("tests/authorized/result_custom_error.rs");

    // Attribute with no parens
    // Invocations:
    // - #[authorized]
    t.compile_fail("tests/authorized/no_parens.rs");

    // Empty attribute
    // Invocations:
    // - #[authorized()]
    t.compile_fail("tests/authorized/empty_attr.rs");

    // String literal as trust level
    // Invocations:
    // - #[authorized("Medium")]
    t.compile_fail("tests/authorized/string_trust_level.rs");

    // Invalid trust level name
    // Invocations:
    // - #[authorized(Invalid)]
    t.compile_fail("tests/authorized/invalid_trust_level.rs");

    // Whitelist without explicit trust level
    // Invocations:
    // - #[authorized(whitelist = ["app"])]
    t.compile_fail("tests/authorized/whitelist_without_level.rs");

    // Non-identifier trust level
    // Invocations:
    // - #[authorized(42)]
    t.compile_fail("tests/authorized/numeric_trust_level.rs");

    // Result with incompatible error type (? fails because From conversion doesn't exist)
    // Invocations:
    // - #[authorized(Medium)]
    t.compile_fail("tests/authorized/result_incompatible_error.rs");
}
