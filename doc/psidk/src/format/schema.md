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
- Exactly one of the `"alias"`, `"structFields"`, or `"unionFields"` fields

A definition may also have these optional fields:

- `"customJson"`, a boolean, indicates the type uses custom JSON serialization. We recommend against using this in most cases since it requires special handling in all serializers and deserializers. psibase uses it for public and private keys, signatures, [psibase::AccountNumber], and [psibase::MethodNumber].
- `"definitionWillNotChange"`, a boolean, indicates the definition for this type will not change in the future. It opts into an alternative fracpack encoding which saves 2 bytes.
- [methods](#method-definitions)

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

In Rust, the type varies depending on the Rust definition:

```rust
#[derive(libpsibase::Schema)]
enum MyEnumType {
    Example0,                        // Type: TODO; need to define a C++ equivalent
    Example1(u64),                   // Type: u64
    Example2(u64, u32),              // Type: tuple of u64, u32
    Example3 { foo: u64, bar: u32 }, // Type: a struct named Example3
}
```

The schema format doesn't support discriminants in Rust or `enum` in C++.

```rust
// Not supported
#[derive(libpsibase::Schema)]
enum DoesNotWork {
    x = 4,
    y = 7,
}
```

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

## Type References

We used `{type reference}` to indicate a type reference in the definitions above. This can be one of the following:

- `{"builtinType": "u32"}` - a [built-in type](#built-in-types)
- `{"userType": "Foo"}` - a type defined in the [userType array](#type-definitions)
- `{"vector": {inner type}}` - a vector of inner type
- `{"optional": {inner type}}` - an optional of inner type
- `{"tuple": [{inner type}, ...]}` - a tuple of inner types
- `{"array": {inner type}, "size": 8}` - a fixed-size array of inner type

Built-in types live in a separate namespace from user-defined types to minimize conflicts in the future if more built-in types are added.

## Built-in Types

`{"builtinType":"..."}` can name one of the following built-in types:

- `void`: only supported as a method return type
- `bool`
- `u8`, `u16`, `u32`, `u64`: unsigned integers
- `i8`, `i16`, `i32`, `i64`: signed integers
- `f32`, `f64`: floating-point types
- `string`

## TODO

- actions, args, return
- events
- tables
- binary compatibility (rules derived from fracpack rules)

## Schema Schema

The schema schema defines both the JSON format and the binary (fracpack) format of schemas.

```
TODO...
```
