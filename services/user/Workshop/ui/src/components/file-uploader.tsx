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

  const { mutateAsync } = useUploadTree();

  const handleFileChange = async (
    selectedFiles: {
      name: string;
      contentType: string;
      path: string;
      bytes: Uint8Array;
    }[]
  ) => {
    const res = await mutateAsync({
      account: Account.parse(currentApp),
      compressionQuality: 0,
      files: selectedFiles.map((file) => ({
        contentType: file.contentType,
        path: file.path,
        content: file.bytes,
      })),
    });

    console.log(res, "was the res");

    selectedFiles.forEach((file) => {
      console.log("File uploaded:", file.name);
      console.log("File content (Uint8Array):", file.bytes);
      console.log("File should be at", siblingUrl(null, currentApp, file.path));
    });
  };

  return (
    <div className="w-full">
      <FileInput onChange={handleFileChange} />
    </div>
  );
};
