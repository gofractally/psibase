import { ChangeEvent, useState } from "react";

interface Base64InputProps {
  value: Uint8Array;
  onChange: (value: Uint8Array, rawInput: string) => void;
  rawInput: string;
}

const needsBase64Padding = (str: string): number => {
  const len = str.replace(/=/g, "").length;
  return (4 - (len % 4)) % 4;
};

const base64ToBytes = (base64: string): Uint8Array | null => {
  try {
    const binary = atob(base64);
    return new Uint8Array(Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
};

const isValidBase64 = (str: string): boolean => {
  if (!/^[A-Za-z0-9+/]*=*$/.test(str)) return false;

  const existingPadding = (str.match(/=+$/)?.[0] || "").length;
  const neededPadding = needsBase64Padding(str);

  if (existingPadding === 0 && neededPadding !== 0) return false;
  if (existingPadding > 0 && existingPadding !== neededPadding) return false;

  return base64ToBytes(str) !== null;
};

export const Base64Input = ({ onChange, rawInput }: Base64InputProps) => {
  const [isValid, setIsValid] = useState(true);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newInput = e.target.value.replace(/[^A-Za-z0-9+/=]/g, "");
    const isValid = isValidBase64(newInput);
    setIsValid(isValid);
    onChange(
      isValid ? base64ToBytes(newInput) ?? new Uint8Array() : new Uint8Array(),
      newInput
    );
  };

  const handleBlur = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const missingPadding = needsBase64Padding(value);
    const existingPadding = (value.match(/=+$/)?.[0] || "").length;

    if (missingPadding > 0 && existingPadding === 0) {
      const paddedValue = value + "=".repeat(missingPadding);
      if (isValidBase64(paddedValue)) {
        const bytes = base64ToBytes(paddedValue) ?? new Uint8Array();
        onChange(bytes, paddedValue);
        setIsValid(true);
      }
    }
  };

  return (
    <div>
      <input
        type="text"
        className="common-input"
        value={rawInput}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="Enter base64 string"
      />
      <div className={`base64-status ${isValid ? "valid" : "invalid"}`}>
        {isValid ? "valid base64" : "invalid base64"}
      </div>
    </div>
  );
};
