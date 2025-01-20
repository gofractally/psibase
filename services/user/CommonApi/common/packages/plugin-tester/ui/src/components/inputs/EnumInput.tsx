import { ReactNode } from "react";

interface EnumCase {
  name: string;
}

interface EnumInputProps {
  cases: EnumCase[];
  value: string | null;
  onChange: (value: string) => void;
  label?: ReactNode;
}

export const EnumInput = ({
  cases,
  value,
  onChange,
  label,
}: EnumInputProps) => {
  // Default to first case if no value is selected
  const selectedCase = value ?? cases[0].name;

  return (
    <div className="input-field">
      {label && <label>{label}</label>}
      <select
        className="common-input"
        value={selectedCase}
        onChange={(e) => onChange(e.target.value)}
      >
        {cases.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
};
