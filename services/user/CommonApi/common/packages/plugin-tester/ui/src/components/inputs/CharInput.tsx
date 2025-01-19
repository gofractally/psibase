import { ReactNode } from "react";

interface CharInputProps {
  value: string;
  onChange: (value: string) => void;
  label?: ReactNode;
}

export const CharInput = ({ value, onChange, label }: CharInputProps) => {
  const handleChange = (newValue: string) => {
    // Take only the first character if multiple are entered
    onChange(newValue.charAt(0));
  };

  return (
    <div className="input-field">
      {label && <label>{label}</label>}
      <input
        type="text"
        className="common-input"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        maxLength={1}
        style={{ width: "3rem" }}
      />
    </div>
  );
};
