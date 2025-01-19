import { ChangeEvent } from "react";

interface HexInputProps {
  value: Uint8Array;
  onChange: (value: Uint8Array, rawInput: string) => void;
  rawInput: string;
}

export const HexInput = ({ onChange, rawInput }: HexInputProps) => {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    // Keep only valid hex characters
    const newHexString = e.target.value.replace(/[^0-9a-fA-F]/g, "");

    // Parse to bytes
    const normalized = newHexString.toLowerCase();
    // Only parse complete pairs
    const completePairsLength = normalized.length & ~1; // round down to even
    const byteCount = completePairsLength / 2;
    const byteArray = new Uint8Array(byteCount);

    for (let i = 0; i < completePairsLength; i += 2) {
      byteArray[i >> 1] = parseInt(normalized.slice(i, i + 2), 16);
    }

    // Push only the fully parsed bytes to the parent
    onChange(byteArray, newHexString);
  };

  return (
    <input
      type="text"
      className="common-input"
      value={rawInput}
      onChange={handleChange}
      placeholder="Enter hex value (e.g. 48656c6c6f)"
      spellCheck={false}
    />
  );
};
