# Schema Format

Psibase has a schema format which describes the fracpack-format data and JSON-format data it uses for action arguments, event content, and database content.

## Type Definitions

Types are represented by a variant with the following alternatives.

### Int

A fixed size integer.

| Field    | Type    | Description                       |
|----------|---------|-----------------------------------|
| bits     | Integer | The width of the integer in bits. |
| isSigned | Boolean | Whether the integer is signed     |

Implementations MUST support 1, 8, 16, 32, and 64 bit integers and MAY support additional widths.

### Float

A floating point number.

| Field    | Type    | Description                                                  |
|----------|---------|--------------------------------------------------------------|
| exp      | Integer | The number of bits in the exponent                           |
| mantissa | Integer | The number of bits in the mantissa (including the leading 1) |

Implementations MUST support single `{"exp":8,"mantissa":24}` and double `{"exp":11,"mantissa":53}` precision and MAY support additional combinations.

### Struct

A non-extensible user defined type. The order of the struct fields is significant.

```json
{
  "Struct" : {
    "i": <field type>,
    "j": <field type>,
    ...
  }
}
```

### Object

An extensible user defined type. The order of the object fields is significant.

```json
{
  "Object" : {
    "i": <field type>,
    "j": <field type>,
    ...
  }
}
```

### Tuple

A tuple type.

```json
{
  "Tuple" : [
    <type>, <type>, ...
  ]
}
```

### Array

A fixed length array type.

| Field | Type    | Description                         |
|-------|---------|-------------------------------------|
| type  | Type    | The element type of the array       |
| len   | Integer | The number of elements in the array |

### List

A variable size list.

```json
{
  "List": <element type>
}
```

### Option

An optional value.

```json
{
  "Option": <element type>
}
```

### Variant

A variant type. The order of alternatives is significant.

```json
{
  "Variant" : {
    "u": <alternative type>,
    "v": <alternative type>,
    ...
  }
}
```

Alternatives whose names begin with `@` are untagged. The result of parsing JSON that matches more than one alternative is unspecified.

> Note: Since JSON parsing is quite permissive, types might match unexpectedly. It's most reliable to have no more than one untagged alternative in a variant.

### FracPack

```json
{
  "FracPack": <nested type>
}
```

This is encoded as a byte vector `{"List": {"Int": {"bits": 8,"isSigned": false}}}`.

### Custom

A type with a custom JSON representation.

| Field | Type   | Description                                                                                                                   |
|-------|--------|-------------------------------------------------------------------------------------------------------------------------------|
| type  | Type   | The underlying type                                                                                                           |
| id    | String | Identifies the custom representation. If the implementation does not know the id, it SHOULD fall back to the underlying type. |

Implementations should support at least the following custom types

| Id     | Underlying Type                                                   | JSON format   |
|--------|-------------------------------------------------------------------|---------------|
| bool   | u1                                                                | true or false |
| hex    | Any fixed size type, List of fixed size types, or nested FracPack | Hex string    |
| string | List of 8-bit integers                                            | String        |
| map    | List of Object, Struct, or Tuple with exactly two members         | JSON Object   |

These custom types are used by psibase

| Id            | Underlying Type                                                 | JSON format       |
|---------------|-----------------------------------------------------------------|-------------------|
| AccountNumber | u64                                                             | String            |
| TimePointSec  | Any integer type representing seconds since the UNIX epoch      | ISO 8601 Extended |
| TimePointUSec | Any integer type representing microseconds since the UNIX epoch | ISO 8601 Extended |

### Named Type

A String used where a type is expected will be treated as a named type. The actual type will be looked up the the type map.

## Type Map

A schema includes a map of named types. This is required to allow recursive type definitions. Type names that begin with "@" are internal to the schema and MAY be renamed any time the schema is processed.

## TODO

- tables

## Schema Schema

The schema schema defines both the JSON format and the binary (fracpack) format of schemas.


```json
{
  "ServiceSchema": {
    "Object": {
      "service": "@AccountNumber",
      "types": "@typemap",
      "actions": "@actions",
      "ui": "@events",
      "history": "@events",
      "merkle": "@events"
    }
  },
  "@typemap": {
    "Custom": {
      "id": "map",
      "type": {"List":{"Object": {"name": "@string", "type": "@type"}}}
    }
  },
  "@actions": {
    "Custom": {
      "id": "map",
      "type": {"List": {"Object": {"name":"@string", "type": "@fn"}}}
    }
  },
  "@events": {
    "Custom": {
      "id": "map",
      "type": {"List": {"Object": {"name":"@string", "type": "@type"}}}
    }
  },
  "@fn": {
    "params": "@type",
    "result": {"Option": "@type"}
  },
  "@type": {
    "Variant": {
      "Struct": "@typemap",
      "Object": "@typemap",
      "Array": {"Object": {"type": "@type", "len": "@u64"}},
      "List": "@type",
      "Option": "@type",
      "Variant": "@typemap",
      "Tuple": {"List": "@type"},
      "Int": {"Object": {"bits": "@u32", "isSigned": "@bool"}},
      "Float": {"Object": {"exp": "@u32", "mantissa": "@u32"}},
      "FracPack": "@type",
      "Custom": {"Object": {"type": "@type", "id": "@string"}},
      "@Type": "@string",
    }
  },
  "@u8": {"Int": {"bits": 8, "isSigned": false}},
  "@u32": {"Int": {"bits": 32, "isSigned": false}},
  "@u64": {"Int": {"bits": 64, "isSigned": false}},
  "@bool": {"Custom": {"id": "bool", "type": {"Int": {"bits": 1, "isSigned": false}}}},
  "@string": {"Custom": {"id": "string", "type": {"List": "@u8"}}},
  "@AccountNumber": {"Custom": {"id": "AccountNumber", "type": "@u64"}}
}
```
