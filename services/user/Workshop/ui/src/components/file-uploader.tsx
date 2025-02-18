import { useCurrentApp } from "@/hooks/useCurrentApp";
import { FileInput } from "./file-input";
import { useUploadTree } from "@/hooks/useUploadTree";
import { Account, Path } from "@/lib/zodTypes";
import { toast } from "sonner";

interface Props {
  pathPrefix?: string;
  onSuccess?: (fileNames: string[]) => void;
}

export const FileUploader = ({ pathPrefix, onSuccess }: Props) => {
  const currentApp = useCurrentApp();

  const { mutateAsync: uploadFiles, isPending } = useUploadTree();

  console.log({ pathPrefix });

  const handleFileChange = async (
    selectedFiles: {
      name: string;
      contentType: string;
      path: string;
      bytes: Uint8Array;
    }[]
  ) => {
    toast("Uploading...");

    try {
      const files = selectedFiles.map((file) => ({
        contentType: file.contentType,
        path: Path.parse(`${pathPrefix}${file.path}`),
        content: file.bytes,
      }));

      void (await uploadFiles({
        account: Account.parse(currentApp),
        compressionQuality: 11,
        files,
      }));

      if (onSuccess) {
        onSuccess(files.map((file): string => file.path));
      }
    } catch (e) {
      toast("Error uploading", {
        description:
          e instanceof Error ? e.message : `Unrecognised error, see logs`,
      });
      console.error(e);
    }
  };

  return (
    <div className="w-full">
      <FileInput disabled={isPending} onChange={handleFileChange} />
    </div>
  );
};
