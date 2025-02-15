import { ChangeEvent, useState } from "react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "./ui/badge";

interface FileInputProps {
  onChange: (
    files: {
      name: string;
      contentType: string;
      path: string;
      bytes: Uint8Array;
    }[]
  ) => void;
}

export const FileInput = ({ onChange }: FileInputProps) => {
  const [files, setFiles] = useState<
    { name: string; contentType: string; path: string; bytes: Uint8Array }[]
  >([]);

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

    try {
      const fileData = await Promise.all(fileDataPromises);
      setFiles(fileData);
      onChange(fileData);
    } catch {
      setFiles([]);
    }
  };

  return (
    <Card className="p-4">
      <Input type="file" multiple onChange={handleFileChange} />
      {files.length > 0 && (
        <CardContent className="mt-4 space-y-2">
          {files.map((file, index) => (
            <Badge key={index} variant="secondary" className="mr-2">
              {file.name}
            </Badge>
          ))}
        </CardContent>
      )}
    </Card>
  );
};
