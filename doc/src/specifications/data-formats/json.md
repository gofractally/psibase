# JSON Format

Both C++ and Rust services support typed JSON serialization. C++ services use `psio::to_json` and `psio::from_json`. Rust services use [serde_json](https://docs.rs/serde_json/latest/serde_json/).

## Structs

Both psio and serde_json represent structs with named fields as JSON objects.

## Tuples

Tuples are represented as JSON arrays. Beware of the [special cases](#special-cases-rust).

## Numbers

Numbers in JSON are complicated by the fact that many JSON parsers treat all numbers as IEEE double precision floating point. To work around this limitation, some numbers MAY be represented as JSON strings.

- Numbers that cannot be represented exactly in double precision SHOULD be represented as strings, unless the consumer is known to preserve the value correctly.
- Numbers whose type can always be represented exactly in double precision, such as `i32` SHOULD be represented as numbers.
- Parsers SHOULD accept either a number or string wherever a number is expected
- Parsers SHOULD NOT round integer or fixed point fields. Note that many JSON parsers including JavaScript's `JSON.parse` and Rust's `serde_json` make this difficult or impossible when the field is a JSON number.

## Strings

Strings are represented as JSON strings.

## Optional

The empty case is represented as `null` and the non-empty case as the inner type. A struct field that is an empty optional MAY be omitted, instead.

## Vectors and Arrays

Both psio and serde_json represent vectors (`std::Vector`, `Vec`) and arrays (`std::array`, `[T]`) as JSON arrays. Beware of the [special cases](#special-cases-c).

## Variants / Enums

Variants are externally tagged, which is the [default representation in serde](https://serde.rs/enum-representations.html#externally-tagged).

{{#tabs}}
{{#tab name="Rust"}}
```rust
enum Fruit {
    Banana(Banana),
    Apple(Apple),
    Orange(Orange),
}
```
{{#endtab}}
{{#tab name="C++"}}
```c++
using Fruit = std::variant<Banana, Apple, Orange>;
```
{{#endtab}}
{{#endtabs}}

```json
{"Apple": {"variety": "Red Delicious"}}
```

### Special Cases (Rust)

By convention a tuple struct with a single element is used for the newtype pattern. Such a struct is represented as the inner value instead of as a tuple.

```rust
struct Single1(u32);        // 1234
```

If a tuple is intended the inner type can be a tuple

```rust
struct Single((u32,));      // [1234]
```

The unit type in Rust, `()`, is the same type as empty tuple and `serde_json` represents it as `null`. To get a JSON representation like other tuples, `[]`, use a tuple struct:

```rust
struct Empty();
```

### Special Cases (C++)

A `std::vector`, `std::array`, or `std::span` with a value type of `char` or `unsigned char` is represented as a hex string. (Rust has a separate `Hex` type).
