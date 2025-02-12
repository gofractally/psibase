import { useState } from "react";
import { useAppMetadata } from "@/hooks/useAppMetadata";
import { useCurrentApp } from "@/hooks/useCurrentApp";
import { FileInput } from "./file-input";
import { useUploadTree } from "@/hooks/useUploadTree";
import { Account } from "@/lib/zodTypes";
import { siblingUrl } from "../../../../CommonApi/common/packages/common-lib/src";

export const FileUploader = () => {
  const currentApp = useCurrentApp();
  const { data: metadata } = useAppMetadata(currentApp);

  console.log({ metadata });
  const [fileValue, setFileValue] = useState<Uint8Array>(new Uint8Array());
  const [fileName, setFileName] = useState("");

  const { mutateAsync } = useUploadTree();

  const handleFileChange = async (value: Uint8Array, filename: string) => {
    setFileValue(value);
    setFileName(filename);

    console.log("starting upload?");
    await mutateAsync({
      account: Account.parse(currentApp),
      compressionQuality: 0,
      files: [
        {
          contentType: "png",
          path: "/yes.png",
          content: value,
        },
      ],
    });
    console.log("File uploaded:", filename);
    console.log("File content (Uint8Array):", value);
    window.open(siblingUrl(null, currentApp, "/yes.png"));
  };

  return (
    <div className="w-full">
      <h1 className="text-lg font-semibold">Upload Files</h1>
      <FileInput
        value={fileValue}
        onChange={(value, filename) => {
          handleFileChange(value, filename);
        }}
        rawInput={fileName}
      />
    </div>
  );
};
