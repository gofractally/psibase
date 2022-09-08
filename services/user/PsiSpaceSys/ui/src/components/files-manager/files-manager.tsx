import { useEffect, useState } from "react";
import wait from "waait";

import { executeRemove, executeUpload } from "../../operations";
import {
    pollForRemovedFiles,
    pollForUploadedFiles,
    useFilesForAccount,
} from "../../queries";
import { FileItem } from "./file-items";
import { NamedAccountFile } from "./interfaces";
import { PathBreadcrumbs } from "./path-breadcrumbs";
import { UploadingFile, UploadZone } from "./upload-zone";
import {
    extractFileUploadGroups,
    extractPathContent,
    mapRawFilesToUploadParams,
    processArchiveFiles,
} from "./utils";

export type FilesManagerProps = {
    account: string;
};

export const FilesManager = ({ account }: FilesManagerProps) => {
    const { accountFiles, refreshFiles } = useFilesForAccount(account);
    const [path, setPath] = useState("/");
    const [newFiles, setNewFiles] = useState<UploadingFile[]>([]);
    const [pathFiles, setPathFiles] = useState<NamedAccountFile[]>([]);
    const [pathFolders, setPathFolders] = useState<string[]>([]);

    useEffect(() => {
        const extractedPath = extractPathContent(path, accountFiles);
        setPathFiles(extractedPath.pathFiles);
        setPathFolders(extractedPath.pathFolders);
    }, [path, accountFiles]);

    const uploadFiles = async () => {
        let uploadingFiles = newFiles.map((file) => {
            if (file.uploadStatus === "fail") {
                file.uploadStatus = undefined;
            }
            return file;
        });
        setNewFiles([...uploadingFiles]);

        const uploadGroups = extractFileUploadGroups(uploadingFiles);

        for (const filesGroup of uploadGroups) {
            const filesParam = await Promise.all(
                filesGroup.map(mapRawFilesToUploadParams)
            );

            // set to pending
            uploadingFiles = uploadingFiles.map((file) =>
                setFileStatusBasedOnCurrentGroup(file, filesGroup, "pending")
            );
            setNewFiles([...uploadingFiles]);

            executeUpload({ path, files: filesParam });
            await wait(2000); // TODO: Would be great if the operation returned a value

            const polledFiles = await pollForUploadedFiles(
                account,
                path,
                filesGroup.map((file) => file.name)
            );

            // set success/fail statuses
            uploadingFiles = uploadingFiles.map((file) =>
                setFileStatusBasedOnCurrentGroup(
                    file,
                    filesGroup,
                    polledFiles.includes(file.name) ? "success" : "fail"
                )
            );
            setNewFiles([...uploadingFiles]);
        }

        refreshFiles();

        const hasFailures = uploadingFiles.some(
            (file) => file.uploadStatus === "fail"
        );
        if (hasFailures) {
            throw new Error("One or more files have failed to upload.");
        }
    };

    const setFileStatusBasedOnCurrentGroup = (
        file: UploadingFile,
        filesGroup: UploadingFile[],
        uploadStatus: "success" | "fail" | "pending"
    ) => {
        const isRelevant = filesGroup.find((fg) => fg.name === file.name);
        if (!isRelevant) {
            return file;
        }
        file.uploadStatus = uploadStatus;
        return file;
    };

    const removeFiles = async (filePaths: string[]) => {
        executeRemove({ filePaths });
        await wait(2000); // TODO: Would be great if the operation returned a value
        await pollForRemovedFiles(account, filePaths);
        refreshFiles();
    };

    const handleRemoveFileClick = async (fileName: string) => {
        const filePaths = [path + fileName];
        await removeFiles(filePaths);
    };

    const handleRemoveFolderClick = async (folder: string) => {
        const folderPath = path + folder + "/";
        const filePaths = accountFiles
            .filter((accountFile) => accountFile.path.startsWith(folderPath))
            .map((accountFile) => accountFile.path);
        await removeFiles(filePaths);
    };

    const handleChangeFiles = async (files: File[]) => {
        const processingFiles = [];

        for (const file of files) {
            const extractedFiles = await processArchiveFiles(file);
            processingFiles.push(...extractedFiles);
        }

        setNewFiles(processingFiles);
    };

    const handleRemoveNewFile = (fileName: string) => {
        const updatedNewFiles = newFiles.filter(
            (file) => file.name !== fileName
        );
        setNewFiles(updatedNewFiles);
    };

    const handleFolderClick = (folderName: string) => {
        setPath(`${path}${folderName}/`);
    };

    const handleFileClick = (file: NamedAccountFile) => {
        console.info(file);
        let fileUrl =
            `//${account}.${window.location.host}${file.accountFile.path}`
                // todo: check the need of this replace
                .replace("psispace-sys.", "");
        console.info("opening file", fileUrl, "...");
        window.open(fileUrl, "_blank");
    };

    return (
        <>
            <div className="m-4 font-bold">
                <PathBreadcrumbs
                    account={account}
                    path={path}
                    onPathChange={setPath}
                />
            </div>

            <UploadZone
                files={newFiles}
                onChangeFiles={handleChangeFiles}
                onSubmitUploads={uploadFiles}
                onRemoveNewFile={handleRemoveNewFile}
            />

            {accountFiles.length === 0 && (
                <div className="m-16 text-center">
                    You don't have any file, push the Upload Files button above
                    to upload your first files to your root directory{" "}
                    <span className="font-bold">{account}/</span>
                </div>
            )}

            <div className="ml-8">
                {pathFolders.map((folder) => (
                    <FileItem
                        key={folder}
                        name={folder}
                        isFolder
                        onClick={() => handleFolderClick(folder)}
                        onRemoveClick={() => handleRemoveFolderClick(folder)}
                    />
                ))}

                {pathFiles.map((file) => (
                    <FileItem
                        key={file.name}
                        name={file.name}
                        type={file.accountFile.contentType}
                        onClick={() => handleFileClick(file)}
                        onRemoveClick={() => handleRemoveFileClick(file.name)}
                    />
                ))}
            </div>
        </>
    );
};
