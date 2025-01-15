import { Schema, TypeDefinition } from "./types";
import { FunctionCallArgs } from "@psibase/common-lib";

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

const handlePrimitiveType = (type: string): unknown => {
  switch (type) {
    case "string":
      return "";
    case "u8":
    case "u16":
    case "u32":
    case "u64":
    case "s8":
    case "s16":
    case "s32":
    case "s64":
    case "f32":
    case "f64":
      return 0;
    default:
      return "";
  }
};

export const generateInitialValue = (
  type: unknown,
  schema: Schema
): unknown => {
  if (typeof type === "number") {
    return generateInitialValue(schema.types[type].kind, schema);
  }

  if (typeof type === "string") {
    return handlePrimitiveType(type);
  }

  if (typeof type !== "object" || type === null) {
    return "";
  }

  const typeObj = type as TypeDefinition["kind"];
  if (typeObj.record) {
    return typeObj.record.fields.reduce(
      (
        acc: Record<string, unknown>,
        field: { name: string; type: unknown }
      ) => {
        acc[camelCase(field.name)] = generateInitialValue(field.type, schema);
        return acc;
      },
      {}
    );
  }
  if (typeObj.list) return [];
  if (typeObj.type) return generateInitialValue(typeObj.type, schema);
  if (typeObj.option) return null;
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

  return "";
};

type NumericType =
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

interface NumericConstraints {
  min: string | number;
  max: string | number;
  step: number | "any";
  allowFloat: boolean;
  is64Bit: boolean;
}

const constraints: Record<NumericType, NumericConstraints> = {
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

export const getNumericConstraints = (
  type: string
): NumericConstraints | null => {
  return constraints[type as NumericType] || null;
};

export const validateNumericInput = (value: string, type: string): boolean => {
  const typeConstraints = getNumericConstraints(type);
  if (!typeConstraints) return false;

  if (typeConstraints.is64Bit) {
    try {
      const bigValue = BigInt(value);
      const minValue = BigInt(typeConstraints.min);
      const maxValue = BigInt(typeConstraints.max);
      return bigValue >= minValue && bigValue <= maxValue;
    } catch {
      return false;
    }
  }

  const numValue = Number(value);
  if (!typeConstraints.allowFloat && !Number.isInteger(numValue)) {
    return false;
  }

  return (
    numValue >= Number(typeConstraints.min) &&
    numValue <= Number(typeConstraints.max)
  );
};

export const formatTypeName = (type: unknown, schema: Schema): string => {
  if (typeof type === "number") {
    return formatTypeName(schema.types[type].kind, schema);
  }

  if (typeof type === "string") {
    return type;
  }

  if (typeof type !== "object" || type === null) {
    return "unknown";
  }

  const typeObj = type as TypeDefinition["kind"];
  if (typeObj.list) {
    return `list<${formatTypeName(typeObj.list, schema)}>`;
  }
  if (typeObj.option) {
    return `optional<${formatTypeName(typeObj.option, schema)}>`;
  }
  if (typeObj.tuple) {
    return `tuple<${typeObj.tuple.types
      .map((t) => formatTypeName(t, schema))
      .join(", ")}>`;
  }
  if (typeObj.variant) {
    return `variant<${typeObj.variant.cases
      .map(
        (c) => c.name + (c.type ? `<${formatTypeName(c.type, schema)}>` : "")
      )
      .join(" | ")}>`;
  }
  if (typeObj.enum) {
    return `enum<${typeObj.enum.cases.map((c) => c.name).join(" | ")}>`;
  }
  if (typeObj.record) {
    return `record<${typeObj.record.fields
      .map((f) => `${f.name}: ${formatTypeName(f.type, schema)}`)
      .join(", ")}>`;
  }
  if (typeObj.type) {
    return formatTypeName(typeObj.type, schema);
  }

  return "unknown";
};
