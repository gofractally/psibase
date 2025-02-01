import { ReactNode } from "react";
import { Schema } from "../../types";
import { TypeBasedInput } from "./TypeBasedInput";
import { getTypeInfo } from "../../utils";

interface OptionalInputProps {
  innerType: unknown;
  schema: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
  label?: ReactNode;
}

export const OptionalInput = ({
  innerType,
  schema,
  value,
  onChange,
  label,
}: OptionalInputProps) => {
  const isEnabled = value !== null;

  return (
    <div className="input-field">
      <div className="optional-header">
        <input
          type="checkbox"
          checked={isEnabled}
          onChange={(e) => {
            if (!e.target.checked) {
              onChange(null);
            } else {
              onChange(getTypeInfo(innerType, schema).defaultValue);
            }
          }}
          className="common-checkbox"
        />
        {label && <label>{label}</label>}
      </div>
      {isEnabled && (
        <div className="optional-content">
          <TypeBasedInput
            type={innerType}
            schema={schema}
            value={value}
            onChange={onChange}
          />
        </div>
      )}
    </div>
  );
};
