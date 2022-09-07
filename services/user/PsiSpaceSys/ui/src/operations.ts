import { operation } from "common/rpc.mjs";
import { psiSpaceContract, UploadFileParam } from "./contracts";

export type UploadFilesOperationPayload = {
    path?: string;
    files: UploadFileParam[];
};

const UPLOAD_FILES = {
    id: "upload_files",
    exec: async ({ path = "/", files }: UploadFilesOperationPayload) => {
        try {
            await psiSpaceContract.actionUpload(path, files);
        } catch (e) {
            console.error("upload_files operation failed:", e);
        }
    },
};

export const operations = [UPLOAD_FILES];

export const executeUpload = async (payload: UploadFilesOperationPayload) => {
    const appletId = await psiSpaceContract.getAppletId();
    operation(appletId, "upload_files", payload);
};
