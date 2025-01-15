import { ReactNode, useState, useEffect } from "react";

type Encoding = "hex" | "base64" | "text";

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
  const [rawInput, setRawInput] = useState("");

  const bytesToString = (bytes: number[]): string => {
    switch (encoding) {
      case "hex":
        return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
      case "base64":
        try {
          // Convert byte array to binary string then to base64
          const binary = bytes.map((b) => String.fromCharCode(b)).join("");
          return btoa(binary);
        } catch {
          return "";
        }
      case "text":
        // Convert bytes to UTF-8 text
        try {
          return new TextDecoder().decode(new Uint8Array(bytes));
        } catch {
          return "";
        }
    }
  };

  const stringToBytes = (str: string, finalize: boolean = false): number[] => {
    try {
      switch (encoding) {
        case "hex": {
          const normalized = str.replace(/[^0-9a-fA-F]/g, "");
          const bytes: number[] = [];
          for (let i = 0; i < normalized.length; i += 2) {
            const byte = normalized.slice(i, i + 2);
            if (byte.length === 2) {
              bytes.push(parseInt(byte, 16));
            }
          }
          return bytes;
        }
        case "base64": {
          if (!finalize) {
            // During typing, just store the raw input without decoding
            return [];
          }
          try {
            // Only decode base64 when finalizing (on blur)
            const binary = atob(str);
            return Array.from(binary, (char) => char.charCodeAt(0));
          } catch {
            return [];
          }
        }
        case "text":
          // Convert text to UTF-8 bytes
          return Array.from(new TextEncoder().encode(str));
      }
    } catch {
      return [];
    }
  };

  // Only update rawInput when encoding changes or value changes externally
  useEffect(() => {
    setRawInput(bytesToString(value));
  }, [encoding, value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let newInput = e.target.value;

    // Filter invalid characters based on encoding
    switch (encoding) {
      case "hex":
        newInput = newInput.replace(/[^0-9a-fA-F]/gi, "");
        break;
      case "base64":
        // Allow only valid base64 characters
        newInput = newInput.replace(/[^A-Za-z0-9+/=]/g, "");
        break;
    }

    setRawInput(newInput);
    const bytes = stringToBytes(newInput, false);
    if (bytes.length > 0) {
      // Only update if we have valid bytes (hex or text mode)
      onChange(bytes);
    }
  };

  const needsBase64Padding = (str: string): number => {
    const len = str.replace(/=/g, "").length;
    return (4 - (len % 4)) % 4;
  };

  const isValidBase64 = (str: string): boolean => {
    // First check if it contains only valid base64 characters
    if (!/^[A-Za-z0-9+/]*=*$/.test(str)) {
      return false;
    }

    // Check if padding is correct
    const existingPadding = (str.match(/=+$/)?.[0] || "").length;
    const neededPadding = needsBase64Padding(str);

    // String must either:
    // 1. Have no padding AND be a complete group (length multiple of 4), or
    // 2. Have the correct amount of padding
    if (existingPadding === 0 && neededPadding !== 0) {
      return false;
    }
    if (existingPadding > 0 && existingPadding !== neededPadding) {
      return false;
    }

    try {
      // Try to decode with current padding
      atob(str);
      return true;
    } catch {
      return false;
    }
  };

  const handleBlur = () => {
    if (encoding === "base64") {
      const missingPadding = needsBase64Padding(rawInput);
      const existingPadding = (rawInput.match(/=+$/)?.[0] || "").length;

      // Only add padding if we need it and don't already have it
      if (missingPadding > 0 && existingPadding === 0) {
        const newInput = rawInput + "=".repeat(missingPadding);
        // Verify the padded string is valid before applying
        try {
          atob(newInput); // Test if it's valid base64
          setRawInput(newInput);
          const bytes = stringToBytes(newInput, true);
          onChange(bytes);
          alert(
            "Added " +
              missingPadding +
              " padding character(s) to make the base64 string valid"
          );
        } catch {
          // If padding doesn't help, leave it as is
          console.warn("Invalid base64 string, padding would not help");
        }
      } else if (isValidBase64(rawInput)) {
        // Only decode if the current input is valid
        const bytes = stringToBytes(rawInput, true);
        onChange(bytes);
      }
    }
  };

  const handleEncodingChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newEncoding = e.target.value as Encoding;
    setEncoding(newEncoding);
  };

  const getPlaceholder = (): string => {
    switch (encoding) {
      case "hex":
        return "Enter hex string (e.g. 0123456789abcdef)";
      case "base64":
        return "Enter base64 string";
      case "text":
        return "Enter UTF-8 text";
    }
  };

  const getPattern = (): string | undefined => {
    switch (encoding) {
      case "hex":
        return "[0-9a-fA-F]*";
      case "base64":
        return "[A-Za-z0-9+\\/=]*";
      case "text":
        return undefined;
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
        {label && <label style={{ margin: 0 }}>{label}</label>}
        <select
          value={encoding}
          onChange={handleEncodingChange}
          className="common-input"
          style={{ width: "auto", marginLeft: "auto" }}
        >
          <option value="hex">Hex</option>
          <option value="base64">Base64</option>
          <option value="text">UTF-8</option>
        </select>
      </div>
      <input
        type="text"
        className="common-input"
        value={rawInput}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={getPlaceholder()}
        pattern={getPattern()}
      />
      {encoding === "base64" && (
        <div
          className={`base64-status ${
            isValidBase64(rawInput) ? "valid" : "invalid"
          }`}
        >
          {isValidBase64(rawInput) ? "valid base64" : "invalid base64"}
        </div>
      )}
    </div>
  );
};
