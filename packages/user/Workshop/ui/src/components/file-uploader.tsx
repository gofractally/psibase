import { useCurrentApp } from "@/hooks/use-current-app";
import { useUploadTree } from "@/hooks/use-upload-tree";
import { zPath } from "@/lib/zod-types";

import { zAccount } from "@shared/lib/schemas/account";
import { toast } from "@shared/shadcn/ui/sonner";

import { FileInput } from "./file-input";

interface Props {
    pathPrefix?: string;
    onSuccess?: (fileNames: string[]) => void;
}

export const FileUploader = ({ pathPrefix, onSuccess }: Props) => {
    const currentApp = useCurrentApp();

    const { mutateAsync: uploadFiles, isPending } = useUploadTree();

    const handleFileChange = async (
        selectedFiles: {
            name: string;
            contentType: string;
            path: string;
            bytes: Uint8Array;
        }[],
    ) => {
        toast("Uploading...");

        try {
            const files = selectedFiles.map((file) => ({
                contentType: file.contentType,
                path: zPath.parse(`${pathPrefix}${file.path}`),
                content: file.bytes,
            }));

            void (await uploadFiles({
                account: zAccount.parse(currentApp),
                compressionQuality: 11,
                files,
            }));

            if (onSuccess) {
                onSuccess(files.map((file): string => file.path));
            }
        } catch (e) {
            toast("Error uploading", {
                description:
                    e instanceof Error
                        ? e.message
                        : `Unrecognised error, see logs`,
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
