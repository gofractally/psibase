import { ChangeEvent } from "react";

interface HexInputProps {
  value: Uint8Array;
  onChange: (value: Uint8Array, rawInput: string) => void;
  rawInput: string;
}

const hexToBytes = (hex: string): Uint8Array => {
  const normalized = hex.toLowerCase();
  const completePairsLength = normalized.length & ~1; // round down to even
  const byteArray = new Uint8Array(completePairsLength >> 1);

  for (let i = 0; i < completePairsLength; i += 2) {
    byteArray[i >> 1] = Number.parseInt(normalized.slice(i, i + 2), 16);
  }

  return byteArray;
};

export const HexInput = ({ onChange, rawInput }: HexInputProps) => {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newHexString = e.target.value.replace(/[^0-9a-fA-F]/g, "");
    onChange(hexToBytes(newHexString), newHexString);
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
