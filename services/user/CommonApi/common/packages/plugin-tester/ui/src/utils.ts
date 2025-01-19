import { Schema, TypeDefinition } from "./types";
import { FunctionCallArgs } from "@psibase/common-lib";

// Type definitions
export type NumericType =
  | "u8"
  | "u16"
  | "u32"
  | "u64"
  | "s8"
  | "s16"
  | "s32"
  | "s64"
  | "f32"
  | "f64";

export type PrimitiveType = NumericType | "string" | "bool" | "char";

export type InputComponentType =
  | "string"
  | "number"
  | "boolean"
  | "optional"
  | "list"
  | "bytelist"
  | "char"
  | "unsupported";

interface NumericConstraints {
  min: string | number;
  max: string | number;
  step: number | "any";
  allowFloat: boolean;
  is64Bit: boolean;
}

// Numeric type constraints
const numericConstraints: Record<NumericType, NumericConstraints> = {
  u8: { min: 0, max: 255, step: 1, allowFloat: false, is64Bit: false },
  u16: { min: 0, max: 65535, step: 1, allowFloat: false, is64Bit: false },
  u32: { min: 0, max: 4294967295, step: 1, allowFloat: false, is64Bit: false },
  u64: {
    min: "0",
    max: "18446744073709551615",
    step: 1,
    allowFloat: false,
    is64Bit: true,
  },
  s8: { min: -128, max: 127, step: 1, allowFloat: false, is64Bit: false },
  s16: { min: -32768, max: 32767, step: 1, allowFloat: false, is64Bit: false },
  s32: {
    min: -2147483648,
    max: 2147483647,
    step: 1,
    allowFloat: false,
    is64Bit: false,
  },
  s64: {
    min: "-9223372036854775808",
    max: "9223372036854775807",
    step: 1,
    allowFloat: false,
    is64Bit: true,
  },
  f32: {
    min: -3.4e38,
    max: 3.4e38,
    step: "any",
    allowFloat: true,
    is64Bit: false,
  },
  f64: {
    min: -1.7976931348623157e308,
    max: 1.7976931348623157e308,
    step: "any",
    allowFloat: true,
    is64Bit: false,
  },
} as const;

// Primitive type utilities
export const isPrimitiveType = (type: string): type is PrimitiveType => {
  return (
    type === "string" ||
    type === "bool" ||
    type === "char" ||
    type in numericConstraints
  );
};

export const isNumericType = (type: string): type is NumericType => {
  return type in numericConstraints;
};

export const getNumericConstraints = (
  type: string
): NumericConstraints | null => {
  return isNumericType(type) ? numericConstraints[type] : null;
};

export const validateNumericInput = (value: string, type: string): boolean => {
  const constraints = getNumericConstraints(type);
  if (!constraints) return false;

  if (value === "") return true;
  if (value === "-" && !constraints.min.toString().startsWith("-"))
    return false;

  const num = constraints.is64Bit ? BigInt(value) : Number(value);
  const min = constraints.is64Bit
    ? BigInt(constraints.min.toString())
    : Number(constraints.min);
  const max = constraints.is64Bit
    ? BigInt(constraints.max.toString())
    : Number(constraints.max);

  return num >= min && num <= max;
};

// String utilities
export function camelCase(str: string): string {
  return str
    .split(/[-_ ]+/)
    .map((w, i) =>
      i === 0
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join("");
}

// RPC utilities
export function withArgs(
  service: string,
  plugin: string,
  intf: string,
  method: string,
  params: unknown[] = []
): FunctionCallArgs {
  return {
    service,
    plugin,
    intf,
    method,
    params,
  };
}

// Internal type utilities
const getInputType = (type: unknown, schema: Schema): InputComponentType => {
  if (typeof type === "number") {
    return getInputType(schema.types[type].kind, schema);
  }

  if (typeof type === "string") {
    if (!isPrimitiveType(type)) return "unsupported";
    if (type === "string") return "string";
    if (type === "bool") return "boolean";
    if (type === "char") return "char";
    if (isNumericType(type)) return "number";
    return "unsupported";
  }

  if (typeof type === "object" && type !== null) {
    const typeObj = type as { option?: unknown; list?: unknown };
    if (typeObj.option) return "optional";
    if (typeObj.list) {
      return typeObj.list === "u8" ? "bytelist" : "list";
    }
  }

  return "unsupported";
};

const getTypeName = (type: unknown, schema: Schema): string => {
  if (typeof type === "number") {
    return getTypeName(schema.types[type].kind, schema);
  }

  if (typeof type === "string") {
    return type;
  }

  if (typeof type !== "object" || type === null) {
    return "unknown";
  }

  const typeObj = type as TypeDefinition["kind"];
  if (typeObj.list) {
    return `list<${getTypeName(typeObj.list, schema)}>`;
  }
  if (typeObj.option) {
    return `optional<${getTypeName(typeObj.option, schema)}>`;
  }
  if (typeObj.tuple) {
    return `tuple<${typeObj.tuple.types
      .map((t) => getTypeName(t, schema))
      .join(", ")}>`;
  }
  if (typeObj.variant) {
    return `variant<${typeObj.variant.cases
      .map((c) => c.name + (c.type ? `<${getTypeName(c.type, schema)}>` : ""))
      .join(" | ")}>`;
  }
  if (typeObj.enum) {
    return `enum<${typeObj.enum.cases.map((c) => c.name).join(" | ")}>`;
  }
  if (typeObj.record) {
    return `record<${typeObj.record.fields
      .map((f) => `${f.name}: ${getTypeName(f.type, schema)}`)
      .join(", ")}>`;
  }
  if (typeObj.type) {
    return getTypeName(typeObj.type, schema);
  }

  return "unknown";
};

const generateInitialValue = (type: unknown, schema: Schema): unknown => {
  if (typeof type === "number") {
    return generateInitialValue(schema.types[type].kind, schema);
  }

  const inputType = getInputType(type, schema);
  switch (inputType) {
    case "string":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "char":
      return "";
    case "list":
    case "bytelist":
      return [];
    case "optional":
      return null;
  }

  // Handle remaining complex types
  if (typeof type === "object" && type !== null) {
    const typeObj = type as TypeDefinition["kind"];
    if (typeObj.record) {
      return typeObj.record.fields.reduce(
        (acc: Record<string, unknown>, field) => {
          acc[camelCase(field.name)] = generateInitialValue(field.type, schema);
          return acc;
        },
        {}
      );
    }
    if (typeObj.type) return generateInitialValue(typeObj.type, schema);
    if (typeObj.tuple) {
      return typeObj.tuple.types.map((type) =>
        generateInitialValue(type, schema)
      );
    }
    if (typeObj.variant) {
      const firstCase = typeObj.variant.cases[0];
      if (!firstCase.type) {
        return firstCase.name;
      }
      return {
        [firstCase.name]: generateInitialValue(firstCase.type, schema),
      };
    }
    if (typeObj.enum) {
      return typeObj.enum.cases[0].name;
    }
  }

  return "";
};

export interface TypeInfo {
  inputType: InputComponentType;
  typeName: string;
  defaultValue: unknown;
}

export const getTypeInfo = (type: unknown, schema: Schema): TypeInfo => {
  // Handle type references first
  if (typeof type === "number") {
    return getTypeInfo(schema.types[type].kind, schema);
  }

  return {
    inputType: getInputType(type, schema),
    typeName: getTypeName(type, schema),
    defaultValue: generateInitialValue(type, schema),
  };
};
