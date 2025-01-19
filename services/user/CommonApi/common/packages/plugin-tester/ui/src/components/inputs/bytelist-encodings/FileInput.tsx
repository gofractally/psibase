import { ChangeEvent, useState } from "react";

interface FileInputProps {
  value: Uint8Array;
  onChange: (value: Uint8Array, rawInput: string) => void;
  rawInput: string;
}

export const FileInput = ({ onChange, rawInput }: FileInputProps) => {
  const [status, setStatus] = useState<"idle" | "success">("idle");

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setStatus("idle");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      onChange(bytes, file.name);
      setStatus("success");
    } catch {
      setStatus("idle");
    }
  };

  return (
    <div>
      <input
        type="file"
        className="common-input"
        onChange={handleFileChange}
        style={{ width: "100%" }}
      />
      {status === "success" && (
        <div className="file-status success">
          File <code>{rawInput}</code> successfully loaded
        </div>
      )}
    </div>
  );
};
