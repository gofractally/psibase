import { Schema } from "../../types";
import { StringInput } from "./StringInput";
import { NumberInput } from "./NumberInput";
import { BooleanInput } from "./BooleanInput";
import { OptionalInput } from "./OptionalInput";
import { ListInput } from "./ListInput";
import { ByteListInput } from "./ByteListInput";
import { getTypeInfo } from "../../utils";

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

  const { inputType, typeName, defaultValue } = getTypeInfo(type, schema);
  const typeLabel = label ? (
    <>
      {label} <span className="type-label">({typeName})</span>
    </>
  ) : undefined;

  const actualValue = value ?? defaultValue;

  switch (inputType) {
    case "string":
      return (
        <StringInput
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
          type={type as string}
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
      if (typeof type === "object" && type !== null) {
        const typeObj = type as { option?: unknown };
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
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
          label={typeLabel}
        />
      );
    case "list":
      if (typeof type === "object" && type !== null) {
        const typeObj = type as { list?: unknown };
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
