import { ChangeEvent, useState } from "react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "./ui/badge";
import { useSetServiceCode } from "@/hooks/useSetServiceCode";
import { useCurrentApp } from "@/hooks/useCurrentApp";
import { Account } from "@/lib/zodTypes";

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

export const ContractUpload = () => {
  const { mutateAsync } = useSetServiceCode();
  const currentApp = useCurrentApp();

  const handleFileChange = async (
    selectedFiles: {
      name: string;
      contentType: string;
      path: string;
      bytes: Uint8Array;
    }[]
  ) => {
    console.log(selectedFiles, "came back");
    // const res = await mutateAsync({
    //   account: Account.parse(currentApp),
    //   compressionQuality: 0,
    //   files: selectedFiles.map((file) => ({
    //     contentType: file.contentType,
    //     path: file.path,
    //     content: file.bytes,
    //   })),
    // });

    const wasm = selectedFiles[0].bytes;

    const res = await mutateAsync({
      account: Account.parse(currentApp),
      code: wasm,
    });

    console.log(res, "was res");
    selectedFiles.forEach((file) => {
      console.log("File uploaded:", file.name);
      console.log("File content (Uint8Array):", file.bytes);
    });
  };

  return (
    <div className="flex flex-row items-center justify-between rounded-lg border p-4">
      Set code
      <FileInput onChange={handleFileChange} />
    </div>
  );
};

//     set-service-code: func(app: string, code: list<u8>) -> result<_, error>;
