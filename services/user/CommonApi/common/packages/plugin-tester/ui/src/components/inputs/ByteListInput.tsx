import { ReactNode, useState, useEffect, useRef } from "react";
import { HexInput } from "./bytelist-encodings/HexInput";
import { Base64Input } from "./bytelist-encodings/Base64Input";
import { Utf8Input } from "./bytelist-encodings/Utf8Input";
import {
  EncodingSelector,
  Encoding,
} from "./bytelist-encodings/EncodingSelector";

interface ByteListInputProps {
  value: Uint8Array;
  onChange: (value: Uint8Array) => void;
  label?: ReactNode;
}

function arraysEqual(a: Uint8Array, b?: Uint8Array) {
  if (!b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

interface RawInputs {
  hex: string;
  base64: string;
  utf8: string;
}

type EncodingInputProps = {
  value: Uint8Array;
  onChange: (value: Uint8Array, rawInput: string) => void;
  rawInput: string;
};

export const ByteListInput = ({
  value: externalValue,
  onChange: externalOnChange,
  label,
}: ByteListInputProps) => {
  const [encoding, setEncoding] = useState<Encoding>("hex");
  const internalValue = useRef(externalValue ?? new Uint8Array());
  const [rawInputs, setRawInputs] = useState<RawInputs>(() => ({
    hex: Array.from(externalValue ?? new Uint8Array())
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
    base64: "", // Will be initialized when switching to base64
    utf8: "", // Will be initialized when switching to utf8
  }));

  // Only update our internal value if the external value has actually changed
  useEffect(() => {
    if (!arraysEqual(externalValue, internalValue.current)) {
      internalValue.current = externalValue ?? new Uint8Array();
      // Only initialize raw inputs for the current encoding
      setRawInputs((prev) => ({
        ...prev,
        [encoding]: getEncodedString(internalValue.current, encoding),
      }));
    }
  }, [externalValue, encoding]);

  const getEncodedString = (bytes: Uint8Array, encoding: Encoding): string => {
    switch (encoding) {
      case "hex":
        return Array.from(bytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      case "base64":
        return btoa(
          Array.from(bytes)
            .map((b) => String.fromCharCode(b))
            .join("")
        );
      case "utf8":
        return new TextDecoder().decode(bytes);
    }
  };

  const handleChange = (newValue: Uint8Array, rawInput: string) => {
    internalValue.current = newValue;
    setRawInputs((prev) => ({
      ...prev,
      [encoding]: rawInput,
    }));
    externalOnChange(newValue);
  };

  const handleEncodingChange = (newEncoding: Encoding) => {
    // Reset the raw input for the new encoding based on the current byte array
    const newRawInput = getEncodedString(internalValue.current, newEncoding);
    setRawInputs((prev) => ({
      ...prev,
      [newEncoding]: newRawInput,
    }));
    setEncoding(newEncoding);
  };

  const renderInput = () => {
    const props: EncodingInputProps = {
      value: internalValue.current,
      onChange: handleChange,
      rawInput: rawInputs[encoding],
    };

    switch (encoding) {
      case "hex":
        return <HexInput {...props} />;
      case "base64":
        return <Base64Input {...props} />;
      case "utf8":
        return <Utf8Input {...props} />;
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
        <EncodingSelector value={encoding} onChange={handleEncodingChange} />
        {label && <label style={{ margin: 0 }}>{label}</label>}
      </div>
      <div style={{ marginTop: "0.5rem" }}>{renderInput()}</div>
    </div>
  );
};
