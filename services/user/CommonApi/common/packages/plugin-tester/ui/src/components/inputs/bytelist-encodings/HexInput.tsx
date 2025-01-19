import { ReactNode } from "react";

interface HexInputProps {
  value: number[];
  onChange: (value: number[]) => void;
  label?: ReactNode;
}

export const HexInput = ({ value, onChange }: HexInputProps) => {
  const bytesToHex = (bytes: number[]): string => {
    return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const hexToBytes = (hex: string): number[] => {
    const normalized = hex.replace(/[^0-9a-fA-F]/g, "");
    const bytes: number[] = [];
    for (let i = 0; i < normalized.length; i += 2) {
      const byte = normalized.slice(i, i + 2);
      if (byte.length === 2) {
        bytes.push(parseInt(byte, 16));
      }
    }
    return bytes;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newInput = e.target.value.replace(/[^0-9a-fA-F]/gi, "");
    const bytes = hexToBytes(newInput);
    onChange(bytes);
  };

  return (
    <div style={{ width: "100%" }}>
      <input
        type="text"
        className="common-input"
        value={bytesToHex(value)}
        onChange={handleChange}
        placeholder="Enter hex string (e.g. 0123456789abcdef)"
        pattern="[0-9a-fA-F]*"
      />
    </div>
  );
};
