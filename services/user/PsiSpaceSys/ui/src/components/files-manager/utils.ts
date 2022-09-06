import { uint8ArrayToHex } from "common/rpc.mjs";
import JSZip from "jszip";
import mime from "mime";

import { UploadFileParam } from "../../contracts";
import { AccountFile } from "../../queries";
import { NamedAccountFile } from "./interfaces";

export const extractPathContent = (
    path: string,
    accountFiles: AccountFile[]
) => {
    const pathFiles: NamedAccountFile[] = [];
    const pathFolders: string[] = [];

    const currentPathLevel = path.split("/").length;

    for (const file of accountFiles) {
        if (file.path.startsWith(path)) {
            const filePaths = file.path.split("/");
            const relativeFileName = filePaths[currentPathLevel - 1];

            if (filePaths.length === currentPathLevel) {
                pathFiles.push({
                    name: relativeFileName,
                    accountFile: { ...file },
                });
            } else if (!pathFolders.includes(relativeFileName)) {
                pathFolders.push(relativeFileName);
            }
        }
    }

    return { pathFiles, pathFolders };
};

export const mapRawFilesToUploadParams = async (
    file: File
): Promise<UploadFileParam> => {
    const buffer = await file.arrayBuffer();
    const contentHex = uint8ArrayToHex(new Uint8Array(buffer));
    return {
        name: file.name,
        type: file.type,
        contentHex,
    };
};

export const processArchiveFiles = async (
    maybeArchive: File
): Promise<File[]> => {
    let zipArchive: JSZip;
    try {
        zipArchive = await JSZip.loadAsync(maybeArchive);
    } catch (e) {
        const error = e as Error;
        if (error.message.includes("is this a zip file")) {
            // not recognized archive files, can just be added as a single file
            return [maybeArchive];
        } else {
            console.error(e, maybeArchive);
            throw e;
        }
    }

    const extractedFiles = [];

    for (const fileName of Object.keys(zipArchive.files)) {
        const zippedFile = zipArchive.files[fileName];

        // skip directories
        if (zippedFile.dir) {
            continue;
        }

        const bytes = await zippedFile.async("uint8array");
        const type = mime.getType(fileName) || undefined;
        const file = new File([bytes], fileName, { type });
        extractedFiles.push(file);
    }

    return extractedFiles;
};
