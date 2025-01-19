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

const isValidBase64 = (str: string): boolean => {
  if (!/^[A-Za-z0-9+/]*=*$/.test(str)) {
    return false;
  }

  const existingPadding = (str.match(/=+$/)?.[0] || "").length;
  const neededPadding = needsBase64Padding(str);

  if (existingPadding === 0 && neededPadding !== 0) {
    return false;
  }
  if (existingPadding > 0 && existingPadding !== neededPadding) {
    return false;
  }

  try {
    atob(str);
    return true;
  } catch {
    return false;
  }
};

export const Base64Input = ({ onChange, rawInput }: Base64InputProps) => {
  const [isValid, setIsValid] = useState(true);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newInput = e.target.value.replace(/[^A-Za-z0-9+/=]/g, "");
    setIsValid(isValidBase64(newInput));

    if (isValidBase64(newInput)) {
      try {
        const binary = atob(newInput);
        const bytes = new Uint8Array(
          Array.from(binary, (char) => char.charCodeAt(0))
        );
        onChange(bytes, newInput);
      } catch {
        // Invalid base64, but keep the raw input
        onChange(new Uint8Array(), newInput);
      }
    } else {
      onChange(new Uint8Array(), newInput);
    }
  };

  const handleBlur = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const missingPadding = needsBase64Padding(value);
    const existingPadding = (value.match(/=+$/)?.[0] || "").length;

    if (missingPadding > 0 && existingPadding === 0) {
      const paddedValue = value + "=".repeat(missingPadding);
      if (isValidBase64(paddedValue)) {
        const binary = atob(paddedValue);
        const bytes = new Uint8Array(
          Array.from(binary, (char) => char.charCodeAt(0))
        );
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
