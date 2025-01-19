import { ChangeEvent } from "react";

interface Utf8InputProps {
  value: Uint8Array;
  onChange: (value: Uint8Array, rawInput: string) => void;
  rawInput: string;
}

const isValidUtf8String = (str: string): boolean => {
  try {
    return str === decodeURIComponent(encodeURIComponent(str));
  } catch {
    return false;
  }
};

export const Utf8Input = ({ onChange, rawInput }: Utf8InputProps) => {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;

    // Validate UTF-8
    if (!isValidUtf8String(newValue)) {
      return;
    }

    // Convert string to byte array
    const encoder = new TextEncoder();
    const bytes = encoder.encode(newValue);
    onChange(bytes, newValue);
  };

  return (
    <input
      type="text"
      className="common-input"
      value={rawInput}
      onChange={handleChange}
      placeholder="Enter UTF-8 text"
      spellCheck={false}
    />
  );
};
