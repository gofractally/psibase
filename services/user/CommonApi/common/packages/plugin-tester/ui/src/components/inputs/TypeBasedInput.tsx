import { Schema } from "../../types";
import { StringInput } from "./StringInput";
import { NumberInput } from "./NumberInput";
import { BooleanInput } from "./BooleanInput";
import { OptionalInput } from "./OptionalInput";
import { ListInput } from "./ListInput";
import { ByteListInput } from "./ByteListInput";
import { formatTypeName } from "../../utils";

interface TypeBasedInputProps {
  type: unknown;
  schema: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
  label?: string;
}

export const TypeBasedInput = ({
  type,
  schema,
  value,
  onChange,
  label,
}: TypeBasedInputProps) => {
  const typeLabel = label ? (
    <>
      {label}{" "}
      <span className="type-label">({formatTypeName(type, schema)})</span>
    </>
  ) : undefined;

  // Handle type references (numbers in the schema)
  if (typeof type === "number") {
    return (
      <TypeBasedInput
        type={schema.types[type].kind}
        schema={schema}
        value={value}
        onChange={onChange}
        label={label}
      />
    );
  }

  // Handle primitive types
  if (typeof type === "string") {
    switch (type) {
      case "string":
        return (
          <StringInput
            value={value as string}
            onChange={onChange}
            label={typeLabel}
          />
        );
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
        return (
          <NumberInput
            value={value as number}
            onChange={onChange}
            label={typeLabel}
            type={type}
          />
        );
      case "bool":
        return (
          <BooleanInput
            value={value as boolean}
            onChange={onChange}
            label={typeLabel}
          />
        );
      default:
        return <div>Unsupported type: {type}</div>;
    }
  }

  // Handle complex types
  if (typeof type === "object" && type !== null) {
    const typeObj = type as { option?: unknown; list?: unknown };

    if (typeObj.option) {
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

    if (typeObj.list) {
      // Special case for list<u8> (bytelist)
      if (typeObj.list === "u8") {
        const arrayValue = Array.isArray(value) ? value : [];
        return (
          <ByteListInput
            value={arrayValue}
            onChange={onChange}
            label={typeLabel}
          />
        );
      }

      // Regular list handling
      const arrayValue = Array.isArray(value) ? value : [];
      return (
        <ListInput
          itemType={typeObj.list}
          schema={schema}
          value={arrayValue}
          onChange={onChange}
          label={typeLabel}
        />
      );
    }
  }

  // For now, show placeholder for other complex types
  return <div>Complex type editor coming soon...</div>;
};
