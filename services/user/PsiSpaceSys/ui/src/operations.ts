import { operation } from "@psibase/common-lib";
import { psiSpaceContract, UploadFileParam } from "./contracts";

export type UploadFilesOperationPayload = {
    path?: string;
    files: UploadFileParam[];
};

export type RemoveFilesOperationPayload = {
    filePaths: string[];
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

const REMOVE_FILES = {
    id: "remove_files",
    exec: async ({ filePaths }: RemoveFilesOperationPayload) => {
        try {
            await psiSpaceContract.actionRemove(filePaths);
        } catch (e) {
            console.error("remove_files operation failed:", e);
        }
    },
};

export const operations = [UPLOAD_FILES, REMOVE_FILES];

export const executeUpload = async (payload: UploadFilesOperationPayload) => {
    const appletId = await psiSpaceContract.getAppletId();
    operation(appletId, "upload_files", payload);
};

export const executeRemove = async (payload: RemoveFilesOperationPayload) => {
    const appletId = await psiSpaceContract.getAppletId();
    operation(appletId, "remove_files", payload);
};
