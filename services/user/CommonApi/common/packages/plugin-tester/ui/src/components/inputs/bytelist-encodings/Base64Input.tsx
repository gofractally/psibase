import { ReactNode, useState } from "react";

interface Base64InputProps {
  value: number[];
  onChange: (value: number[]) => void;
  label?: ReactNode;
}

export const Base64Input = ({ value, onChange }: Base64InputProps) => {
  const [isValid, setIsValid] = useState(true);

  const bytesToBase64 = (bytes: number[]): string => {
    try {
      const binary = bytes.map((b) => String.fromCharCode(b)).join("");
      return btoa(binary);
    } catch {
      return "";
    }
  };

  const base64ToBytes = (base64: string): number[] => {
    try {
      const binary = atob(base64);
      return Array.from(binary, (char) => char.charCodeAt(0));
    } catch {
      return [];
    }
  };

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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newInput = e.target.value.replace(/[^A-Za-z0-9+/=]/g, "");
    setIsValid(isValidBase64(newInput));
    if (isValidBase64(newInput)) {
      const bytes = base64ToBytes(newInput);
      onChange(bytes);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const missingPadding = needsBase64Padding(value);
    const existingPadding = (value.match(/=+$/)?.[0] || "").length;

    if (missingPadding > 0 && existingPadding === 0) {
      const paddedValue = value + "=".repeat(missingPadding);
      if (isValidBase64(paddedValue)) {
        e.target.value = paddedValue;
        const bytes = base64ToBytes(paddedValue);
        onChange(bytes);
        setIsValid(true);
      }
    }
  };

  return (
    <div>
      <input
        type="text"
        className="common-input"
        value={bytesToBase64(value)}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="Enter base64 string"
        pattern="[A-Za-z0-9+/=]*"
      />
      <div className={`base64-status ${isValid ? "valid" : "invalid"}`}>
        {isValid ? "valid base64" : "invalid base64"}
      </div>
    </div>
  );
};
