# fracpack

Psibase uses a new binary format, `fracpack`, which has the following goals:

- Quickly pack and unpack data, making it suitable for service-to-service communication, node-to-node communication, blockchain-to-outside communication, and database storage.
- Forwards and backwards compatibility; it supports adding new optional fields to the end of structs and tuples, even when they are embedded in variable-length vectors, fixed-length arrays, optional, and other structs and tuples.
- Option to read without unpacking (almost zero-copy); helps to efficiently handle large data.
- Doesn't require a code generator to support either C++ or Rust; macros and metaprogramming handle it.
- Efficient compression when combined with the compression algorithm from Cap 'n' Proto. Note: psibase doesn't currently use this.

Psibase uses fracpack for all of its message formats and uses it for database storage. Wherever psibase uses binary data, it's in fracpack format. There is one slight deviation: cryptographic types, even though they are normally stored in fracpack format, use a different binary format when encoded as a string (e.g. `PUB_K1_898DAWuc...`). Encoders and decoders take care of the extra conversion. e.g. when converting action arguments from json to binary, they decode the base-58 string, verify the checksum, then convert the resulting binary into fracpack format.

This document describes fracpack's binary format; it does not describe either C++'s or Rust's reflection, encoding, and decoding facilities.

## Fixed-Size vs Variable-Size Objects

fracpack classifies objects into two categories: fixed size and variable size. The format for fixed-size objects is similar to what you'd get if you used memcpy, except subobjects, if any, are packed tightly without padding; fracpack doesn't align data. The format for variable-size objects is more complicated; see [Variable-Size Objects](#variable-size-objects).

## Fixed-Size Objects

### Numeric types

Numeric types are in twos-complement little-endian format. They are unaligned. This is the currently-supported set:

- Boolean: 1 byte; either 0 or 1
- Unsigned integer sizes (bits): 8, 16, 32, 64
- Signed integer sizes (bits): 8, 16, 32, 64
- Floating point: 32 and 64 bits; Intel format
- TODO: void; 0 bytes. This is for tagged-union alternatives which have no payload

### Non-Extensible Fixed-Size Structs

A non-extensible struct is one that will never gain new fields in the future. Non-extensibility requires an explicit opt-in; fracpack considers structs extensible by default. fracpack's extensibility mechanism is unrelated to inheritance; fracpack doesn't model inheritance and its C++ implementation doesn't understand it.

A struct which is non-extensible and which contains only fixed-sized subobjects is itself fixed size. Its subobjects are packed in order without padding. A struct is variable size if it is extensible (the default) or if it contains any variable-sized data within it. Variable-size structs have a [different encoding](#variable-size-structs).

### Fixed-Length Arrays of Fixed-Size Objects

A fixed-length array which contains fixed-size objects is itself fixed size. Its subobjects are packed in order without padding.

## Variable-Size Objects

Variable-size objects contain two parts: a fixed-size (but sometimes growable) area and a variable-size area. Child objects live in one (or both) of these areas within the parent.

### Variable-Size Structs

A struct is variable size if it is extensible (the default) or if it contains any variable-sized data within it. It has the following layout:

```
uint16_t            fixed_size;     // The amount of data in fixed_data
uint8_t[fixed_size] fixed_data;     // Fixed-size objects and offsets
                                    //   to variable-size objects
uint8_t[]           variable_data;  // Variable-size inner objects
```

Fixed-size subobjects live entirely within `fixed_data`. Variable-size subobjects have an [Offset Pointer](#offset-pointers) in `fixed_data` which points into `variable_data`. `variable_data` MUST be encoded in order with no gaps. `fixed_size`, when present, enables decoders to safely skip newly-added optional fields. `fixed_size` is only present for extensible (the default) structs. Non-extensible structs don't have it since the fixed size is always known in that case.

### Tuples

Tuples have the same encoding as structs, except they don't have a non-extensible option; tuples are always extensible, so they're always variable-size.

### Unit (Rust)

Fracpack treats the unit type (`()`) as an empty tuple. Be careful since this creates an inconsistency with `serde_json`, which renders unit as `null` instead of `[]`. See `Empty`, below, for an alternative.

### Unit Structs (Rust)

Fracpack doesn't support unit structs. See `Empty`, below, for an alternative.

```
// Not supported
struct MyUnit;
```

### Tuple Structs (Rust)

Fracpack encodes these structs as tuples. This matches `serde_json` semantics. Beware of the [special cases](#special-cases-rust).

```
struct Empty();                         // Encodes as an empty tuple
struct TupleOfOne((u32,));              // Encodes as a tuple
struct TupleOfTwo(u32, String);         // Encodes as a tuple
struct TupleOfThree(u32, String, f64);  // Encodes as a tuple
```

### Special Cases (Rust)

Fracpack encodes these structs as their inner items instead of encoding them as a struct or tuple. This matches `serde_json` semantics. This can result in either a fixed-size object or a variable-size object.

```
struct Single1(u32);        // Encodes as a u32 (fixed size)
struct Single2(String, );   // Encodes as a String (variable size)
```

### Offset Pointers

When a subobject is variable size, it has an Offset Pointer which points to the beginning of that subobject. Offset pointers are unsigned 32-bit integers which record the difference between the target address and the pointer's address. Values 0-3 point to within the offset pointer itself; they have special meaning:

- `0`: indicates a vector or string is empty
- `1`: indicates an optional is empty
- `2,3`: reserved for future use

The special values are a space-saving measure. e.g. suppose we have an `std::optional<std::string>`. The 3 possible states, `nullopt`, `empty`, and `!empty`, are encoded as `1`, `0`, or an offset.

### Fixed-Length Arrays of Variable-Size Objects

These have the following encoding:

```
uint8_t[fixed_size] fixed_data;     // Offsets to Variable-size objects
uint8_t[]           variable_data;  // Variable-size inner objects
```

`fixed_size` has a known size, so isn't recorded.

### Vectors and Strings

Vectors and Strings have the following encoding:

```
uint32_t            fixed_size;     // The amount of data in fixed_data
uint8_t[fixed_size] fixed_data;     // Fixed-size objects or offsets to
                                    //   Variable-size objects
uint8_t[]           variable_data;  // Variable-size objects
```

`fixed_size` indirectly encodes the vector's length. If it's a vector of some type `T`, and that type is fixed size, then then vector length is `fixed_size / T's size`. If `T` is variable size, then the vector length is `fixed_size / 4`. Note that `fixed_size` here is 32 bits instead of 16, which is used in structs.

### Optionals

Optionals always use a variable-size encoding, whether their inner data is fixed-size or variable size. An optional represents an empty state by using `1` for its [Offset Pointer](#offset-pointers). It represents non-empty as an Offset Pointer which points to the contained data. If the contained data is variable-size, then it already uses an offset pointer; Optional reuses this pointer to save space.

There are 2 special rules for optionals embedded within extensible structs and tuples:

- If any field is optional, then all the remaining fields must also be optional.
- If the last `n` optional fields are empty, then they must be omitted from `fixed_data`.

TODO: Implement these rules in Rust. Verify them in C++.

TODO: Reconsider this rule. Its purpose is to guarantee that decoding and re-encoding a fracpacked binary results in an identical binary. There are situations which prevent the guarantee, e.g. unrecognized but populated fields in an upgraded struct, tuple, or union, accidental NaN normalization, and potentially more. Psibase doesn't rely on this guarantee. It places a burden on both fracpack implementors and on users.

### Tagged Unions

Tagged Unions (`std::variant` in C++ or `enum` in Rust) have the following encoding:

```
uint8_t         tag;    // Identifies the alternative; 0 is first
uint32_t        size;   // The amount of data
uint8_t[size]   data;   // Selected inner object
```

Alternatives are sequentially-numbered starting from `0`. The must not be greater than 127. The `size` field allows decoders to safely skip newly-added alternatives that they are not aware of.

## Safety Checking

When deserializing an object of type `T`, if the data is not a valid serialization of any type that can be deserialized as `T`, validation MUST fail. The following is a non-exhaustive list of conditions that MUST be validated:
- bool values must be 0 or 1
- Unknown fixed data MUST be a multiple of 4 octets and each 4-octet group MUST be a valid offset pointer
- Every regular offset pointer MUST equal the end of the preceding object if it is known
- Every offset pointer MUST be in bounds
- The size of a vector must be an exact multiple of the fixed size of each element
- An offset pointer to an empty vector must be represented as 0
- The size of a variant must be the same as the size of the inner object if the inner size is known

TODO: finish this list. Make sure both the C++ and Rust implementations' checkers enforce the rules.

## Serialization Compatibility

An serialized object of type `T` may be deserialized as type `U` if any of the following conditions hold
- `T` is the same type as `U`
- `T` and `U` are both non-extensible structs with the same number of members AND each member of `T` can be deserialized as the corresponding member of `U`
- `T` and `U` are both tuples or extensible structs with the same number of members AND each member of `T` can be deserialized as the corresponding member of `U`
- `T` and `U` are both tuples or extensible structs AND `T` has fewer members than `U` AND every member of `T` can be deserialized as the corresponding member of `U` AND every trailing member of `U` that does not have a corresponding member of `T` is optional. The trailing members of `U` will be be set to empty.
- `T` and `U` are both tuples or extensible structs AND `T` has more members than `U` AND every member of `T` that has a corresponding member of `U` can be deserialized as the corresponding member of `U` AND every trailing member of `T` that does not have a corresponding member of `U` is optional. The trailing members of `T` will be dropped.
- `T` and `U` are unions AND `U` has at least as many alternatives as `T` AND every alternative of `T` can be deserialized as the corresponding alternative of `U`
- `T` and `U` are both containers of the same kind AND the value type of `T` can be deserialized as the value type of `U`. The possible kinds of containers are optional, array, and vector.
