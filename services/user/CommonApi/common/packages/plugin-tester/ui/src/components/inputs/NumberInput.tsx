import { ReactNode } from "react";
import {
  getNumericConstraints,
  validateNumericInput,
} from "../../NumericConstraints";

interface NumberInputProps {
  value: number | bigint;
  onChange: (value: number | bigint) => void;
  label?: ReactNode;
  type: string;
}

export const NumberInput = ({
  value,
  onChange,
  label,
  type,
}: NumberInputProps) => {
  const constraints = getNumericConstraints(type);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value === "" ? "0" : e.target.value;
    if (validateNumericInput(newValue, type)) {
      if (constraints?.is64Bit) {
        onChange(BigInt(newValue));
      } else {
        onChange(Number(newValue));
      }
    }
  };

  return (
    <div className="input-field">
      {label && <label>{label}</label>}
      <input
        type="text"
        className="common-input"
        value={value.toString()}
        onChange={handleChange}
        pattern={constraints?.allowFloat ? "[0-9]*[.]?[0-9]*" : "[0-9]*"}
      />
    </div>
  );
};
