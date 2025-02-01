import { ReactNode } from "react";

interface StringInputProps {
  value: string;
  onChange: (value: string) => void;
  label?: ReactNode;
}

export const StringInput = ({ value, onChange, label }: StringInputProps) => {
  return (
    <div className="input-field">
      {label && <label>{label}</label>}
      <input
        type="text"
        className="common-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
};
