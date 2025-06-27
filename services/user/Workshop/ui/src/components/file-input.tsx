import { ChangeEvent } from "react";
import { Input } from "@shared/shadcn/ui/input";
import { Card } from "@shared/shadcn/ui/card";

interface FileInputProps {
  onChange: (
    files: {
      name: string;
      contentType: string;
      path: string;
      bytes: Uint8Array;
    }[]
  ) => void;
  disabled?: boolean;
}

export const FileInput = ({ onChange, disabled }: FileInputProps) => {
  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    const selectedFiles = Array.from(e.target.files);
    const fileDataPromises = selectedFiles.map(async (file) => {
      const buffer = await file.arrayBuffer();
      return {
        name: file.name,
        contentType: file.type,
        path: `/${file.name}`,
        bytes: new Uint8Array(buffer),
      };
    });

    const fileData = await Promise.all(fileDataPromises);
    onChange(fileData);
  };

  return (
    <Card className="p-4 border-none">
      <Input
        disabled={disabled}
        type="file"
        multiple
        onChange={handleFileChange}
      />
    </Card>
  );
};
