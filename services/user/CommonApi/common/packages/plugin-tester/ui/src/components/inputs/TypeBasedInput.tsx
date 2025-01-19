import { Schema } from "../../types";
import { StringInput } from "./StringInput";
import { NumberInput } from "./NumberInput";
import { BooleanInput } from "./BooleanInput";
import { OptionalInput } from "./OptionalInput";
import { ListInput } from "./ListInput";
import { ByteListInput } from "./ByteListInput";
import { CharInput } from "./CharInput";
import { getTypeInfo } from "../../utils";
import { useMemo } from "react";

interface TypeBasedInputProps {
  type: unknown;
  schema: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
  label?: string;
}

// Convert to Uint8Array if needed
const getByteArray = (val: unknown): Uint8Array => {
  if (val instanceof Uint8Array) return val;
  if (Array.isArray(val)) return new Uint8Array(val);
  return new Uint8Array();
};

export const TypeBasedInput = ({
  type,
  schema,
  value,
  onChange,
  label,
}: TypeBasedInputProps) => {
  const resolvedType =
    typeof type === "number" ? schema.types[type].kind : type;
  const { inputType, typeName, defaultValue } = getTypeInfo(
    resolvedType,
    schema
  );
  const actualValue = value ?? defaultValue;
  const memoizedBytes = useMemo(
    () =>
      inputType === "bytelist" ? getByteArray(actualValue) : new Uint8Array(),
    [inputType, actualValue]
  );

  const typeLabel = label ? (
    <>
      {label} <span className="type-label">({typeName})</span>
    </>
  ) : undefined;

  switch (inputType) {
    case "string":
      return (
        <StringInput
          value={actualValue as string}
          onChange={onChange}
          label={typeLabel}
        />
      );
    case "char":
      return (
        <CharInput
          value={actualValue as string}
          onChange={onChange}
          label={typeLabel}
        />
      );
    case "number":
      return (
        <NumberInput
          value={actualValue as number}
          onChange={onChange}
          label={typeLabel}
          type={resolvedType as string}
        />
      );
    case "boolean":
      return (
        <BooleanInput
          value={actualValue as boolean}
          onChange={onChange}
          label={typeLabel}
        />
      );
    case "optional":
      if (typeof resolvedType === "object" && resolvedType !== null) {
        const typeObj = resolvedType as { option?: unknown };
        return (
          <OptionalInput
            innerType={typeObj.option}
            schema={schema}
            value={value}
            onChange={onChange}
            label={typeLabel}
          />
        );
      }
      break;
    case "bytelist":
      return (
        <ByteListInput
          value={memoizedBytes}
          onChange={onChange}
          label={typeLabel}
          schema={schema}
        />
      );
    case "list":
      if (typeof resolvedType === "object" && resolvedType !== null) {
        const typeObj = resolvedType as { list?: unknown };
        return (
          <ListInput
            itemType={typeObj.list}
            schema={schema}
            value={Array.isArray(value) ? value : []}
            onChange={onChange}
            label={typeLabel}
          />
        );
      }
      break;
    case "unsupported":
      return <div>Unsupported type: {typeName}</div>;
  }

  return <div>Complex type editor coming soon...</div>;
};
