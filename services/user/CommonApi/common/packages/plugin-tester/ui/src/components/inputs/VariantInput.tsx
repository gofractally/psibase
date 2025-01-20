import { ReactNode } from "react";
import { Schema } from "../../types";
import { TypeBasedInput } from "./TypeBasedInput";
import { getTypeInfo } from "../../utils";

interface VariantCase {
  name: string;
  type?: unknown;
}

export interface VariantValue {
  tag: string;
  value?: unknown;
}

interface VariantInputProps {
  cases: VariantCase[];
  schema: Schema;
  value: VariantValue | null;
  onChange: (value: VariantValue) => void;
  label?: ReactNode;
}

export const VariantInput = ({
  cases,
  schema,
  value,
  onChange,
  label,
}: VariantInputProps) => {
  // Get the currently selected case, defaulting to first case if value is null/undefined
  const selectedCase = value?.tag ?? cases[0].name;

  const handleCaseChange = (caseName: string) => {
    const selectedVariant = cases.find((c) => c.name === caseName);
    if (!selectedVariant) return;

    // If the variant case has no type, just use the tag
    if (!selectedVariant.type) {
      onChange({ tag: caseName });
      return;
    }

    // Otherwise include both tag and value
    onChange({
      tag: caseName,
      value: getTypeInfo(selectedVariant.type, schema).defaultValue,
    });
  };

  const handleValueChange = (newValue: unknown) => {
    onChange({ tag: selectedCase, value: newValue });
  };

  const selectedVariant = cases.find((c) => c.name === selectedCase);

  return (
    <div className="input-field">
      {label && <label>{label}</label>}
      <select
        className="common-input"
        value={selectedCase}
        onChange={(e) => handleCaseChange(e.target.value)}
        style={{ marginBottom: "0.5rem" }}
      >
        {cases.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
      {!!selectedVariant?.type && (
        <div className="variant-content">
          <TypeBasedInput
            type={selectedVariant.type}
            schema={schema}
            value={value?.value}
            onChange={handleValueChange}
          />
        </div>
      )}
    </div>
  );
};
