import { ReactNode } from "react";

interface Utf8InputProps {
  value: number[];
  onChange: (value: number[]) => void;
  label?: ReactNode;
}

export const Utf8Input = ({ value, onChange }: Utf8InputProps) => {
  const bytesToUtf8 = (bytes: number[]): string => {
    try {
      return new TextDecoder().decode(new Uint8Array(bytes));
    } catch {
      return "";
    }
  };

  const utf8ToBytes = (text: string): number[] => {
    return Array.from(new TextEncoder().encode(text));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const bytes = utf8ToBytes(e.target.value);
    onChange(bytes);
  };

  return (
    <input
      type="text"
      className="common-input"
      value={bytesToUtf8(value)}
      onChange={handleChange}
      placeholder="Enter UTF-8 text"
    />
  );
};
