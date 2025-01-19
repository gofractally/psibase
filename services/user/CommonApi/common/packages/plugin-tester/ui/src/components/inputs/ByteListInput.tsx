import { ReactNode, useState, useEffect, useRef } from "react";
import { HexInput } from "./bytelist-encodings/HexInput";
import { Base64Input } from "./bytelist-encodings/Base64Input";
import { Utf8Input } from "./bytelist-encodings/Utf8Input";
import { FileInput } from "./bytelist-encodings/FileInput";
import { ListInput } from "./ListInput";
import { Schema } from "../../types";
import {
  EncodingSelector,
  Encoding,
} from "./bytelist-encodings/EncodingSelector";

interface ByteListInputProps {
  value: Uint8Array;
  onChange: (value: Uint8Array) => void;
  label?: ReactNode;
  schema: Schema;
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
  file: string;
  manual: string;
}

type EncodingInputProps = {
  value: Uint8Array;
  onChange: (value: Uint8Array, rawInput: string) => void;
  rawInput: string;
};

const getEncodedString = (
  bytes: Uint8Array,
  encoding: Encoding,
  filename = ""
): string => {
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
    case "file":
      return filename;
    default:
      return "";
  }
};

export const ByteListInput = ({
  value: externalValue,
  onChange: externalOnChange,
  label,
  schema,
}: ByteListInputProps) => {
  const [encoding, setEncoding] = useState<Encoding>("hex");
  const internalValue = useRef(externalValue ?? new Uint8Array());
  const [rawInputs, setRawInputs] = useState<RawInputs>(() => ({
    hex: getEncodedString(externalValue ?? new Uint8Array(), "hex"),
    base64: "",
    utf8: "",
    file: "",
    manual: "",
  }));

  useEffect(() => {
    if (!arraysEqual(externalValue, internalValue.current)) {
      internalValue.current = externalValue ?? new Uint8Array();
      setRawInputs((prev) => ({
        ...prev,
        [encoding]: getEncodedString(
          internalValue.current,
          encoding,
          prev.file
        ),
      }));
    }
  }, [externalValue, encoding]);

  const handleChange = (newValue: Uint8Array, rawInput: string) => {
    internalValue.current = newValue;
    setRawInputs((prev) => ({
      ...prev,
      [encoding]: rawInput,
    }));
    externalOnChange(newValue);
  };

  const handleEncodingChange = (newEncoding: Encoding) => {
    const newRawInput = getEncodedString(
      internalValue.current,
      newEncoding,
      rawInputs.file
    );
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
      case "file":
        return <FileInput {...props} />;
      case "manual":
        return (
          <ListInput
            itemType="u8"
            schema={schema}
            value={Array.from(internalValue.current)}
            onChange={(value) =>
              handleChange(new Uint8Array(value as number[]), "")
            }
          />
        );
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
