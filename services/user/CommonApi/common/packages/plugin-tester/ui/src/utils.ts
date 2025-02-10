import { Schema, TypeDefinition } from "./types";
import { NumericType, isNumericType } from "./NumericConstraints";
import { camelCase } from "./StringUtils";
import { withArgs } from "./RpcUtils";

// Type definitions
export type PrimitiveType = NumericType | "string" | "bool" | "char";

export type InputComponentType =
  | "string"
  | "number"
  | "boolean"
  | "optional"
  | "list"
  | "bytelist"
  | "char"
  | "tuple"
  | "variant"
  | "enum"
  | "record"
  | "flags"
  | "unsupported";

export const isPrimitiveType = (type: string): type is PrimitiveType =>
  type === "string" ||
  type === "bool" ||
  type === "char" ||
  isNumericType(type);

// Re-export utilities
export { camelCase, withArgs };

// Type system types
interface TypeInfo {
  inputType: InputComponentType;
  typeName: string;
  defaultValue: unknown;
}

interface TypeField {
  name: string;
  type: unknown;
}

interface TypeCase {
  name: string;
  type?: unknown;
}

interface TypeHandler<T> {
  primitive: (type: string) => T;
  option: (inner: TypeKind, schema: Schema) => T;
  list: (inner: TypeKind, schema: Schema) => T;
  tuple: (types: TypeKind[], schema: Schema) => T;
  variant: (cases: TypeCase[], schema: Schema) => T;
  enum: (cases: { name: string }[]) => T;
  record: (fields: TypeField[], schema: Schema) => T;
  flags: (flags: { name: string }[]) => T;
  unsupported: () => T;
}

type TypeKind = unknown;

// Type system implementation
const handleType = <T>(
  type: TypeKind,
  schema: Schema,
  handler: TypeHandler<T>
): T => {
  if (typeof type === "number") {
    return handleType(schema.types[type].kind, schema, handler);
  }

  if (typeof type === "string") {
    return isPrimitiveType(type)
      ? handler.primitive(type)
      : handler.unsupported();
  }

  if (typeof type === "object" && type !== null) {
    const typeObj = type as TypeDefinition["kind"];
    if (typeObj.option) return handler.option(typeObj.option, schema);
    if (typeObj.list) return handler.list(typeObj.list, schema);
    if (typeObj.tuple) return handler.tuple(typeObj.tuple.types, schema);
    if (typeObj.variant) return handler.variant(typeObj.variant.cases, schema);
    if (typeObj.enum) return handler.enum(typeObj.enum.cases);
    if (typeObj.record) return handler.record(typeObj.record.fields, schema);
    if (typeObj.flags) return handler.flags(typeObj.flags.flags);
    if (typeObj.type) return handleType(typeObj.type, schema, handler);
  }

  return handler.unsupported();
};

const inputTypeHandler: TypeHandler<InputComponentType> = {
  primitive: (type) =>
    type === "string"
      ? "string"
      : type === "char"
      ? "char"
      : type === "bool"
      ? "boolean"
      : "number",
  option: () => "optional",
  list: (inner) => (inner === "u8" ? "bytelist" : "list"),
  tuple: () => "tuple",
  variant: () => "variant",
  enum: () => "enum",
  record: () => "record",
  flags: () => "flags",
  unsupported: () => "unsupported",
};

const typeNameHandler: TypeHandler<string> = {
  primitive: (type) => type,
  option: (inner, schema) =>
    `option<${handleType(inner, schema, typeNameHandler)}>`,
  list: (inner, schema) =>
    `list<${handleType(inner, schema, typeNameHandler)}>`,
  tuple: (types, schema) =>
    `tuple<${types
      .map((t) => handleType(t, schema, typeNameHandler))
      .join(", ")}>`,
  variant: (cases, schema) =>
    `variant<${cases
      .map((c) =>
        c.type
          ? `${c.name}: ${handleType(c.type, schema, typeNameHandler)}`
          : c.name
      )
      .join(", ")}>`,
  enum: (cases) => `enum<${cases.map((c) => c.name).join(", ")}>`,
  record: (fields, schema) =>
    `record<${fields
      .map((f) => `${f.name}: ${handleType(f.type, schema, typeNameHandler)}`)
      .join(", ")}>`,
  flags: (flags) => `flags<${flags.map((f) => f.name).join(", ")}>`,
  unsupported: () => "unknown",
};

const initialValueHandler: TypeHandler<unknown> = {
  primitive: (type) =>
    type === "string" || type === "char" ? "" : type === "bool" ? false : 0,
  option: () => null,
  list: (inner) => (inner === "u8" ? new Uint8Array() : []),
  tuple: (types, schema) =>
    types.map((t) => handleType(t, schema, initialValueHandler)),
  variant: (cases, schema) => ({
    tag: cases[0].name,
    val: cases[0].type
      ? handleType(cases[0].type, schema, initialValueHandler)
      : undefined,
  }),
  enum: (cases) => cases[0].name,
  record: (fields, schema) =>
    fields.reduce(
      (acc, field) => ({
        ...acc,
        [field.name]: handleType(field.type, schema, initialValueHandler),
      }),
      {}
    ),
  flags: (flags) =>
    flags.reduce((acc, flag) => ({ ...acc, [flag.name]: false }), {}),
  unsupported: () => null,
};

export const getTypeInfo = (type: TypeKind, schema: Schema): TypeInfo => ({
  inputType: handleType(type, schema, inputTypeHandler),
  typeName: handleType(type, schema, typeNameHandler),
  defaultValue: handleType(type, schema, initialValueHandler),
});
