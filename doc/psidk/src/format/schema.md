# Schema Format

psibase has a schema format which describes the fracpack-format data and JSON-format data it uses for action arguments, event content, and database content.

TODO: implement schema

## Type Definitions

Type definitions live in the `userType` array:

```json
{
    "userType": [
        {definition},
        {definition},
        ...
    ]
}
```

Each definition has at least these fields:

- `"name"`: name of the type
- Exactly one of the [`"alias"`](#alias-definitions), [`"structFields"`](#struct-definitions), or [`"unionFields"`](#union-definitions) fields

A definition may also have these optional fields:

- `"customJson"`, a boolean, indicates the type uses custom JSON serialization. We recommend against using this in most cases since it requires special handling in all serializers and deserializers. psibase uses it for public and private keys, signatures, [psibase::AccountNumber], and [psibase::MethodNumber]. The serialization libraries which communicate with psibase (e.g. the js library) support this set, but not additional ones. Only valid for structs.
- `"definitionWillNotChange"`, a boolean, indicates the definition for this type will not change in the future. It opts into an alternative fracpack encoding which saves 2 bytes. Only valid for structs.
- [`"methods"`](#method-definitions). Only valid for structs.

### Alias Definitions

An alias definition creates an alternative name for a type:

```json
{
    "name": "NameGoesHere",
    "alias": {type reference}
}
```

The syntax for referencing types [appears below](#type-references).

### Struct Definitions

A struct definition has this form:

```json
{
    "name": "NameGoesHere",
    "structFields": [
        {
            "name": "field1",
            "type": {type reference}
        },
        ...
    ]
}
```

### Struct Upgradeability

The following change to a struct maintains backwards binary and JSON compatibility, but only if `definitionWillNotChange` isn't true:

- Add additional `std::optional` (C++) or `Option` (Rust) fields to the end of the struct

The following break backwards compatibility; if you do these, data will end up corrupted:

- Don't reorder or drop fields
- Don't add new fields at the beginning or middle
- Don't add new non-optional fields to the end
- Don't change anything if `definitionWillNotChange` (defaults to false) is true
- Don't change `definitionWillNotChange`

### Union Definitions

A union definition describes an `std::variant` in C++ or an `enum` in Rust.

```json
{
    "name": "NameGoesHere",
    "unionFields": [
        {
            "name": "alternative0",
            "type": {type reference}
        },
        ...
    ]
}
```

In C++, each type comes from the variant's type parameters. The names come from (TODO: variant name reflection support).

In Rust, both the names and the types come from the Rust definition:

```rust
#[derive(libpsibase::Schema)]
enum MyEnumType {
    Example0,                        // Type: TODO; need to define a C++ equivalent
    Example1(u64),                   // Type: u64
    Example2(u64, u32),              // Type: tuple of u64, u32
    Example3((u64,)),                // Type: tuple of u64 (extra parenthesis required)
    Example4 { foo: u64, bar: u32 }, // Type: a struct
    Example5(),                      // Type: empty tuple
    Example6(()),                    // Not supported
}
```

`serde_json` has an interesting gap. Tuples render as `[...]`, but `()`, the unit, renders as `null`. There is no true empty tuple in Rust; `()` comes closest, but fills multiple roles in Rust, which may explain why `serde_json` chose `null` for it. `Example5` opens up an opportunity since `serde_json` renders it as `{"Example5":[]}`. The schema treats it as an empty tuple because it renders like an empty tuple would, if `serde_json` supported empty tuples. Empty tuples are useful because the fracpack format for empty tuples supports adding new optional fields to them in a compatible way. e.g. the following definition is compatible with the above definition:

```rust
#[derive(libpsibase::Schema)]
enum MyEnumType {
    ...
    Example5((Option<u64>, )),  // No longer empty, but still compatible
    ...
}
```

The schema format doesn't support `Example6` because `serde_json` renders it as `{"Example6":null}`.

The schema format doesn't support discriminants in Rust since fracpack numbers alternatives starting at 0 with no gaps. The schema format also doesn't support `enum` in C++; use `std::variant` instead.

```rust
// Not supported
#[derive(libpsibase::Schema)]
enum DoesNotWork {
    x = 4,
    y = 7,
}
```

### Union Upgradeability

The following changes to a union maintain backwards binary and JSON compatibility:

- Add additional alternatives at the end of the enum (Rust) or variant (C++)
- Add additional `std::optional` (C++) or `Option` (Rust) items to the end of an alternative's tuple
- Add additional `std::optional` (C++) or `Option` (Rust) fields to the end of an alternative's struct

In addition, the following changes maintain backwards binary compatibility, but break JSON compatibility:

- Switch an alternative's type from a struct to a tuple, maintaining the order and types of the fields
- Switch an alternative's type from a tuple to struct, maintaining the order and types of the fields

The following break backwards compatibility; if you do these, data will end up corrupted:

- Don't drop alternatives from the enum (Rust) or variant (C++).
- Don't reorder alternatives within the enum (Rust) or variant (C++).
- Don't add additional alternatives to the beginning or middle of the enum (Rust) or variant (C++).
- Don't reorder or drop fields from an alternative's struct or tuple.
- Don't add new fields at the beginning or middle of an alternative's struct or tuple.
- Don't add non-optional fields to the end of an alternative's struct or tuple.
- Don't switch an alternative from a single type, e.g. `Example(u64)`, to a tuple, e.g. `Example((u64,))` or `Example(u64,u32)`, or to a struct, e.g. `Example{...}`
- Don't switch an alternative from a tuple or a struct to a single type.
- Don't switch an alternative from no data to one with data, or vice-versa. You may switch from an empty tuple, e.g. `Example(())`, to a non-empty one containing optionals, e.g. `Example(Option<u64>,Option<u32>)`.

### Method Definitions

A struct definition may have methods on it.

```json
{
    "name": "MyStruct",
    "structFields": [...],
    "methods": [
        {
            "name": "myMethod",
            "returns": {type reference},
            "args": [
                {
                    "name": "arg0",
                    "type": {type reference}
                },
                ...
            ]
        },
        ...
    ]
}
```

If a method doesn't return a value, `returns` should be `{"builtinType": "void"}`.

### Method Upgradeability

The following changes maintain backwards binary and JSON compatibility:

- Add a new method
- Add an optional argument at the end of a method's existing arguments

The following break backwards compatibility; if you do these, data will end up corrupted, or history unreadable:

- Don't remove or rename methods; make them abort instead
- Don't change the return type of a method
- Don't add non-optional arguments to an existing method
- Don't add arguments to the beginning or middle of an existing method's argument list

## Type References

We used `{type reference}` to indicate a type reference in the definitions above. This can be one of the following:

- `{"builtinType": "u32"}` - a [built-in type](#built-in-types)
- `{"userType": "Foo"}` - a type defined in the [userType array](#type-definitions)
- `{"vector": {inner type}}` - a vector of inner type
- `{"optional": {inner type}}` - an optional of inner type
- `{"tuple": [{inner type}, ...]}` - a tuple of inner types
- `{"array": {inner type}, "size": 8}` - a fixed-size array of inner type

Built-in types live in a separate namespace from user-defined types to minimize conflicts in the future if more built-in types are added.

### Tuple Upgradeability

The following change to a tuple maintains backwards binary and JSON compatibility:

- Add additional `std::optional` (C++) or `Option` (Rust) inner types to the end of the tuple

The following break backwards compatibility; if you do these, data will end up corrupted:

- Don't reorder or drop fields from a tuple
- Don't add new fields at the beginning or middle from a tuple
- Don't add new non-optional fields to the end of a tuple

## Built-in Types

`{"builtinType":"..."}` can name one of the following built-in types:

- `void`: only supported as a method return type
- `bool`
- `u8`, `u16`, `u32`, `u64`: unsigned integers
- `i8`, `i16`, `i32`, `i64`: signed integers
- `f32`, `f64`: floating-point types
- `string`

## TODO

- events
- tables

## Schema Schema

The schema schema defines both the JSON format and the binary (fracpack) format of schemas.

```
TODO...
```
