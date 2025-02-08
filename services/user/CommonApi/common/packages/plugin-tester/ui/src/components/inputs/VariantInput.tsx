import { ReactNode } from "react";
import { Schema } from "../../types";
import { TypeBasedInput } from "./TypeBasedInput";
import { EnumInput } from "./EnumInput";
import { getTypeInfo } from "../../utils";

interface VariantCase {
  name: string;
  type?: unknown;
}

export interface VariantValue {
  tag: string;
  val?: unknown;
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
  const selectedCase = value?.tag ?? cases[0].name;
  const selectedVariant = cases.find((c) => c.name === selectedCase);

  const handleCaseChange = (caseName: string) => {
    const selectedVariant = cases.find((c) => c.name === caseName);
    if (!selectedVariant) return;

    if (!selectedVariant.type) {
      onChange({ tag: caseName });
    } else {
      onChange({
        tag: caseName,
        val: getTypeInfo(selectedVariant.type, schema).defaultValue,
      });
    }
  };

  const handleValueChange = (newValue: unknown) => {
    onChange({ tag: selectedCase, val: newValue });
  };

  return (
    <div className="input-field">
      <EnumInput
        cases={cases}
        value={selectedCase}
        onChange={handleCaseChange}
        label={label}
      />
      {!!selectedVariant?.type && (
        <div className="variant-content">
          <TypeBasedInput
            type={selectedVariant.type}
            schema={schema}
            value={value?.val}
            onChange={handleValueChange}
          />
        </div>
      )}
    </div>
  );
};
