# fracpack

psibase uses a new binary format, `fracpack`, which has the following goals:

- Quickly pack and unpack data, making it suitable for service-to-service communication, node-to-node communication, blockchain-to-outside communication, and database storage.
- Forwards and backwards compatibility; it supports adding new optional fields to the end of structs and tuples, even when they are embedded in variable-length vectors, fixed-length arrays, optional, and other structs and tuples.
- Option to read without unpacking (almost zero-copy); helps to efficiently handle large data.
- Doesn't require a code generator to support either C++ or Rust; macros and metaprogramming handle it.
- Efficient compression when combined with the compression algorithm from Cap 'n' Proto. Note: psibase doesn't currently use this.

psibase uses fracpack for all of its message formats and uses it for database storage. Wherever psibase uses binary data, it's in fracpack format. There is one slight deviation: cryptographic types, even though they are normally stored in fracpack format, use a different binary format when encoded as a string (e.g. `PUB_K1_898DAWuc...`). Encoders and decoders take care of the extra conversion. e.g. when converting action arguments from json to binary, they decode the base-58 string, verify the checksum, then convert the resulting binary into fracpack format.

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

Fixed-size subobjects live entirely within `fixed_data`. Variable-size subobjects have an [Offset Pointer](#offset-pointers) in `fixed_data` which points into `variable_data`. `fixed_size`, when present, enables decoders to safely skip newly-added optional fields. `fixed_size` is only present for extensible (the default) structs. Non-extensible structs don't have it since the fixed size is always known in that case.

### Tuples

Tuples have the same encoding as structs, except they don't have a non-extensible option; tuples are always extensible, so they're always variable-size.

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

There are 2 special rules for optionals embedded within structs and tuples:

- If any field is optional, then all the remaining fields must also be optional.
- If the last `n` optional fields are empty, then they must be omitted from `fixed_data`.

TODO: Implement these rules in Rust. Verify them in C++.

TODO: This rule is incompatible with non-extensible structs since `fixed_size` isn't present.

TODO: Reconsider this rule. Its purpose is to guarantee that decoding and re-encoding a fracpacked binary results in an identical binary. There are situations which prevent the guarantee, e.g. unrecognized but populated fields in an upgraded struct, tuple, or union, accidental NaN normalization, and potentially more. Psibase doesn't rely on this guarantee. It places a burden on both fracpack implementors and on users.

### Tagged Unions

Tagged Unions (`std::variant` in C++ or `enum` in Rust) have the following encoding:

```
uint8_t         tag;    // Identifies the alternative; 0 is first
uint32_t        size;   // The amount of data
uint8_t[size]   data;   // Selected inner object
```

Alternatives are sequentially-numbered starting from `0`. The `size` field allows decoders to safely skip newly-added alternatives that they are not aware of.

## Safety Checking

Fracpack places additional requirements on packed data to enable quick safety checks while decoding.

- `variable_data` must be in the same order as `fixed_data`
- Offset pointers must leave no gaps, except when unknown fields are skipped (e.g. extensible structs, tuples, and unknown enum entries)
- Additional rules for [Optionals](#optionals)
- Tagged Unions' `tag` field must be less than 128. This allows a potential extension in the future which will be signaled by the MSB.

TODO: finish this list. Make sure both the C++ and Rust implementations' checkers enforce the rules.
