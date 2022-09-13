# JSON Format

Both C++ and Rust services support typed JSON serialization. C++ services use `psio::to_json` and `psio::from_json`. Rust services use [serde_json](https://docs.rs/serde_json/latest/serde_json/).

## Structs

Both psio and serde represent structs as JSON objects.

## Numbers

64-bit Numbers are incredibly tricky in JSON, thanks in part to JavaScript, and thanks in part to common JSON libraries in type-safe languages.

- JavaScript's number type can handle integers up to 53 bits unsigned, 54 signed. Extra precision is silently truncated. e.g. `10000000000000001 == 10000000000000000`.
- JavaScript's BigInt type supports arbitrary precision, but JavaScript's built-in JSON conversions don't support it.

The cleanest workaround seems to be to store 64-bit integers in quoted strings, but several widely-used JSON libraries in type-safe languages decided against that workaround, and reject incoming quoted numbers. serde used to support it (input only), but hit some [nasty conflicts](https://github.com/serde-rs/serde/pull/839) and had to remove it. serde provides customization (`serialize_with` and `deserialize_with`), but that gets cumbersome in nested types, e.g. `Option<Vec<u64>>`.

Instead of trying to get type-safe JSON libraries to work around JavaScript's limitations, it's probably time we ask JavaScript to pull its own weight. JavaScript JSON Libraries exist which [handle BigInt](https://www.npmjs.com/package/json-bigint).

`psio::to_json` (C++) does not place 64-bit numbers in quoted strings, but for a time `psio::from_json` will accept numbers in quoted strings for backwards compatibility. `serde_json` (Rust) does not place or accept numbers in quoted strings, unless you use customization. JavaScript needs a JSON library or will silently truncate values.

Unfortunately this creates an inconsistency with GraphQL, which constrains its numeric types to be various subsets of JavaScript's number type. We have no choice but to quote 64-bit integers in GraphQL and declare them as strings in GraphQL schemas, unless we decide to break with the spec.

- TODO: update `psio::to_json` to not quote numbers
- TODO: update JavaScript code

## Strings

`psio::to_json` and `psio::from_json` use JSON strings for `std::string`. serde uses JSON strings for rust's various string types.

## Optional

Both psio (`std::optional`) and serde (`Option`) represent the empty case as `null` and the non-empty case as the inner type.

## Vectors and Arrays

Both psio and serde represent vectors (`std::Vector`, `Vec`) and arrays (`std::array`, `[]` (Rust)) as JSON arrays.

## Byte vectors and arrays

Byte vectors and arrays create a tricky problem. The JSON array-of-numbers representation is wasteful and annoying for this; hex strings are more compact and readable. Base-64 is even more compact, but it is near impossible to read and there are 7 standard RFC encodings, plus more.

When should a vector or array use a hex representation? It's convenient to automatically switch when the element type is an 8-bit number, but this can be jarring for new service developers who don't expect it. We could have a separate "bytes" type, but that's annoying for experienced developers in both Rust and C++. serdes already made a choice: vectors by default use the array notation in JSON. `serialize_with` and `deserialize_with` can opt into other representations, but they are cumbersome in nested types, e.g. `Option<Vec<u8>>`. That leaves a separate "bytes" type. Both Rust and C++ support move semantics to handle any efficiency issues.

- TODO: C++: A fixed-size bytes type
- TODO: C++: Switch existing byte vectors and arrays within psibase structs to bytes wrappers
- TODO: C++: Remove hex representation from `std::vector<*>` and `std::array<*>`
- TODO: C++: fracpack support for encoding `psio::bytes` as a vector instead of a struct of vector
- TODO: C++: fracpack support for encoding new fixed-size bytes type as an array instead of a struct of array
- TODO: Rust: A bytes type
- TODO: Rust: A fixed-size bytes type
- TODO: Rust: fracpack support for encoding bytes type as a vector instead of a struct of vector
- TODO: Rust: fracpack support for encoding fixed-size bytes type as an array instead of a struct of array

## Tuples

Both psio and serde represent tuples as JSON arrays.

- TODO: psio json support for tuples
- TODO: The serde doc kind of infers that it represents the empty tuple `()` as `null`. Verify and update this doc and psio to match.

## Variants / Enums

There are probably as many ways to represent these in JSON as there are grains of sand on the beach. serde supports [4 approaches](https://serde.rs/enum-representations.html). Of these, only the [externally tagged](https://serde.rs/enum-representations.html#externally-tagged) and [adjacently tagged](https://serde.rs/enum-representations.html#adjacently-tagged) representations cover all situations unambiguously.

- TODO: pick one. It will be easier on rust devs if we choose serde's default.
