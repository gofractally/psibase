import { ReactNode, useState } from "react";
import { Schema } from "../../types";
import { TypeBasedInput } from "./TypeBasedInput";
import { camelCase } from "../../utils";

interface RecordField {
  name: string;
  type: unknown;
}

interface RecordInputProps {
  fields: RecordField[];
  schema: Schema;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  label?: ReactNode;
}

export const RecordInput = ({
  fields,
  schema,
  value,
  onChange,
  label,
}: RecordInputProps) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const handleFieldChange = (fieldName: string, fieldValue: unknown) => {
    onChange({
      ...value,
      [camelCase(fieldName)]: fieldValue,
    });
  };

  return (
    <div className="record-input">
      <div
        className={`record-header ${isExpanded ? "expanded" : ""}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="expand-icon" />
        <div className="record-header-content">{label}</div>
      </div>
      <div className={`record-fields ${isExpanded ? "expanded" : ""}`}>
        {fields.map((field) => (
          <TypeBasedInput
            key={field.name}
            type={field.type}
            schema={schema}
            value={value?.[camelCase(field.name)]}
            onChange={(newValue) => handleFieldChange(field.name, newValue)}
            label={field.name}
          />
        ))}
      </div>
    </div>
  );
};
