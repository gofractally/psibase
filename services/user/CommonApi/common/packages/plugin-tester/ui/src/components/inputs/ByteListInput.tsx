import { ReactNode, useState } from "react";
import { HexInput } from "./bytelist-encodings/HexInput";
import { Base64Input } from "./bytelist-encodings/Base64Input";
import { Utf8Input } from "./bytelist-encodings/Utf8Input";
import { EncodingSelector, Encoding } from "./bytelist-encodings/EncodingSelector";

interface ByteListInputProps {
  value: number[];
  onChange: (value: number[]) => void;
  label?: ReactNode;
}

export const ByteListInput = ({
  value,
  onChange,
  label,
}: ByteListInputProps) => {
  const [encoding, setEncoding] = useState<Encoding>("hex");

  const renderInput = () => {
    switch (encoding) {
      case "hex":
        return <HexInput value={value} onChange={onChange} />;
      case "base64":
        return <Base64Input value={value} onChange={onChange} />;
      case "utf8":
        return <Utf8Input value={value} onChange={onChange} />;
    }
  };

  return (
    <div className="input-field">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "0.5rem",
        }}
      >
        <EncodingSelector value={encoding} onChange={setEncoding} />
        {label && <label style={{ margin: 0 }}>{label}</label>}
      </div>
      <div style={{ marginTop: "0.5rem" }}>{renderInput()}</div>
    </div>
  );
};
