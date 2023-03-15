import { uint8ArrayToHex } from "@psibase/common-lib";
import JSZip from "jszip";
import mime from "mime";

import { UploadFileParam } from "../../contracts";
import { AccountFile } from "../../queries";
import { NamedAccountFile } from "./interfaces";
import { UploadingFile } from "./upload-zone";

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
        // unable to extract archive file, it can just be added as a single file then
        return [maybeArchive];
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

/**
 * Split files for uploading in groups of 10 files or 1 MB max.
 */
export const extractFileUploadGroups = (uploadingFiles: UploadingFile[]) => {
    const uploadGroups: UploadingFile[][] = [];
    let currentGroup: UploadingFile[] = [];
    let currentGroupSize = 0;
    const groupSizeLimit = 1024 * 1024; // 1 MB

    for (let i = 0; i < uploadingFiles.length; i++) {
        const newFile = uploadingFiles[i];
        if (newFile.uploadStatus) {
            continue;
        }

        if (
            currentGroup.length === 10 ||
            (newFile.size + currentGroupSize > groupSizeLimit &&
                currentGroup.length > 0)
        ) {
            uploadGroups.push(currentGroup);
            currentGroup = [];
            currentGroupSize = 0;
        }

        currentGroup.push(newFile);
        currentGroupSize += newFile.size;
    }

    if (currentGroup.length > 0) {
        uploadGroups.push(currentGroup);
    }

    return uploadGroups;
};
