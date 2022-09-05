import { useEffect, useState } from "react";
import wait from "waait";
import JSZip from "jszip";

import { executeUpload } from "../../operations";
import { pollForUploadedFiles, useFilesForAccount } from "../../queries";
import { FileItem } from "./file-items";
import { NamedAccountFile } from "./interfaces";
import { PathBreadcrumbs } from "./path-breadcrumbs";
import { UploadZone } from "./upload-zone";
import {
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
    const [newFiles, setNewFiles] = useState<File[]>([]);
    const [pathFiles, setPathFiles] = useState<NamedAccountFile[]>([]);
    const [pathFolders, setPathFolders] = useState<string[]>([]);

    useEffect(() => {
        const extractedPath = extractPathContent(path, accountFiles);
        setPathFiles(extractedPath.pathFiles);
        setPathFolders(extractedPath.pathFolders);
    }, [path, accountFiles]);

    const uploadFiles = async () => {
        const filesParam = await Promise.all(
            newFiles.map(mapRawFilesToUploadParams)
        );
        executeUpload({ path, files: filesParam });

        await wait(2000); // TODO: Would be great if the operation returned a value

        await pollForUploadedFiles(
            account,
            path,
            filesParam.map((fp) => fp.name)
        );

        refreshFiles();
    };

    const handleChangeFiles = async (files: File[]) => {
        const processingFiles = [];

        for (const file of files) {
            const extractedFiles = await processArchiveFiles(file);
            processingFiles.push(...extractedFiles);
        }

        setNewFiles(processingFiles);
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
            <div className="flex items-center justify-between">
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
                />
            </div>

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
                    />
                ))}

                {pathFiles.map((file) => (
                    <FileItem
                        key={file.name}
                        name={file.name}
                        type={file.accountFile.contentType}
                        onClick={() => handleFileClick(file)}
                    />
                ))}
            </div>
        </>
    );
};
