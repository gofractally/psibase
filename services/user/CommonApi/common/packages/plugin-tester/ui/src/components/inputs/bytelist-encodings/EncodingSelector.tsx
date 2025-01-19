export type Encoding = "hex" | "base64" | "utf8";

interface EncodingSelectorProps {
  value: Encoding;
  onChange: (encoding: Encoding) => void;
}

export const EncodingSelector = ({
  value,
  onChange,
}: EncodingSelectorProps) => {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Encoding)}
      className="common-input"
      style={{ width: "auto", minWidth: "100px" }}
    >
      <option value="hex">Hex</option>
      <option value="base64">Base64</option>
      <option value="utf8">UTF-8</option>
    </select>
  );
};
