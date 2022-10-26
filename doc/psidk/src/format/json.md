# JSON Format

Both C++ and Rust services support typed JSON serialization. C++ services use `psio::to_json` and `psio::from_json`. Rust services use [serde_json](https://docs.rs/serde_json/latest/serde_json/).

## Structs

Both psio and serde_json represent structs with named fields as JSON objects.

## Tuples

Both psio and serde_json represent tuples as JSON arrays. The empty tuple has a problem. `psio` renders `std::tuple<>{}` as you'd expect: `[]`. `serde_json`, however, renders `()`, the unit, as `null`. See `Empty`, below, for a workaround.

- TODO: psio json support for tuples

## Unit Structs (Rust)

serde_json represents unit structs (like below) as `null`. We recommend against using this; [fracpack](fracpack.html) and [schema](schema.html) don't support it. See `Empty`, below, for an alternative.

```
struct MyUnit;
```

## Tuple Structs (Rust)

serde_json represents these structs as tuples. Beware of the [special cases](#special-cases-rust).

```
struct Empty();                         // []
struct TupleOfOne((u32,));              // [value]
struct TupleOfTwo(u32, String);         // [value, value]
struct TupleOfThree(u32, String, f64);  // [value, value, value]
```

### Special Cases (Rust)

serde_json represents these structs as their inner values instead of as tuples (`[...]`). [Fracpack](fracpack.html) and [Schema](schema.html) act the same.

```
struct Single1(u32);        // 1234
struct Single2(String, );   // "A string"
```

## Numbers

64-bit Numbers are incredibly tricky in JSON, thanks in part to JavaScript, and thanks in part to common JSON libraries in type-safe languages.

- JavaScript's number type can handle integers up to 53 bits unsigned, 54 signed. Extra precision is silently truncated. e.g. `10000000000000001 == 10000000000000000`.
- JavaScript's [BigInt type](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt) supports arbitrary precision, but JavaScript's built-in JSON conversions don't support it.

The cleanest workaround seems to be to store 64-bit integers in quoted strings, but several widely-used JSON libraries in type-safe languages decided against that workaround, and reject incoming quoted numbers. serde_json used to support it (input only), but hit some [nasty conflicts](https://github.com/serde-rs/serde/pull/839) and had to remove it. serde_json provides customization (`serialize_with` and `deserialize_with`), but that gets cumbersome in nested types, e.g. `Option<Vec<u64>>`.

Instead of trying to get type-safe JSON libraries to work around JavaScript's limitations, it's probably time we ask JavaScript to pull its own weight. JavaScript JSON Libraries exist which [handle BigInt](https://www.npmjs.com/package/json-bigint).

`psio::to_json` (C++) does not place 64-bit numbers in quoted strings, but for a time `psio::from_json` will accept numbers in quoted strings for backwards compatibility. `serde_json` (Rust) does not place or accept numbers in quoted strings, unless you use customization. JavaScript needs a JSON library or will silently truncate values.

- TODO: update `psio::to_json` to not quote numbers
- TODO: Rethink GraphQL numeric handling. It currently relies on `to_json`.
- TODO: update JavaScript code

## Strings

`psio::to_json` and `psio::from_json` use JSON strings for `std::string`. serde_json uses JSON strings for rust's various string types.

## Optional

Both psio (`std::optional`) and serde_json (`Option`) represent the empty case as `null` and the non-empty case as the inner type.

## Vectors and Arrays

Both psio and serde_json represent vectors (`std::Vector`, `Vec`) and arrays (`std::array`, `[]` (Rust)) as JSON arrays.

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

## Variants / Enums

There are probably as many ways to represent these in JSON as there are grains of sand on the beach. serde_json supports [4 approaches](https://serde.rs/enum-representations.html). Of these, only the [externally tagged](https://serde.rs/enum-representations.html#externally-tagged) and [adjacently tagged](https://serde.rs/enum-representations.html#adjacently-tagged) representations cover all situations unambiguously.

- TODO: pick one. It will be easier on rust devs if we choose serde_json's default (externally tagged). It looks like I can take advantage of the syntax of the externally-tagged option to represent nested types in the schema without falling back on a DSL.
