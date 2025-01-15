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
    case "u32":
    case "u64":
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
