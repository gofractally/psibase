import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import wait from "waait";
import useEffectOnce from "../../hooks/useEffectOnce";
import Button from "../button";
import Text from "../text";

export type UploadingFile = File & {
    uploadStatus?: "pending" | "success" | "fail";
};

export type UploadZoneProps = {
    files: UploadingFile[];
    onChangeFiles: (newFiles: File[]) => void;
    onRemoveNewFile: (fileName: string) => void;
    onSubmitUploads: () => Promise<void>;
};

export const UploadZone = ({
    files,
    onChangeFiles,
    onRemoveNewFile,
    onSubmitUploads,
}: UploadZoneProps) => {
    const [isUploading, setIsUploading] = useState(false);
    const [successMessage, setSuccessMessage] = useState("");
    const [errorMessage, setErrorMessage] = useState("");

    const onDrop = useCallback((acceptedFiles: File[]) => {
        setSuccessMessage("");
        setErrorMessage("");
        onChangeFiles(acceptedFiles);
    }, []);

    const { getRootProps, getInputProps } = useDropzone({
        onDrop,
    });

    const handleSubmitUploadsClick = async () => {
        setSuccessMessage("");
        setErrorMessage("");
        setIsUploading(true);
        try {
            await onSubmitUploads();
            setSuccessMessage("Files were uploaded successfully!");
            setIsUploading(false);
            await wait(2000);
            setSuccessMessage("");
            onChangeFiles([]);
        } catch (e) {
            console.error(e);
            setErrorMessage(`Fail to upload files.`);
            setIsUploading(false);
        }
    };

    const handleCancelUploadsClicks = async () => {
        setSuccessMessage("");
        setErrorMessage("");
        onChangeFiles([]);
    };

    const uploadingMessage = isUploading ? "Uploading Files..." : "";
    const message = successMessage || errorMessage || uploadingMessage;
    const messageType = successMessage
        ? "success"
        : errorMessage
        ? "danger"
        : undefined;

    const displayControls = files.length > 0;
    const displayButtons = !isUploading && messageType !== "success";

    const dropZoneHeight = 60;
    const filesBoxHeight = 430;

    return (
        <div className="fixed right-2 bottom-8 bg-white">
            {!displayControls ? (
                <div style={{ height: dropZoneHeight }} {...getRootProps()}>
                    <input {...getInputProps()} />
                    <div className="text-r cursor-pointer border-2 border-dashed border-gray-200 p-4">
                        Drop Files or Click here to Upload
                    </div>
                </div>
            ) : (
                <div
                    style={{ height: filesBoxHeight }}
                    className="w-screen max-w-xl border-2 border-solid border-gray-100"
                >
                    <div className="mb-2 w-full bg-gray-100 p-2 font-semibold">
                        Files to Upload
                    </div>
                    <NewFilesList
                        newFiles={files}
                        removeNewFile={onRemoveNewFile}
                        isUploading={isUploading}
                    />

                    <div className="m-2 flex items-center justify-end text-right">
                        <div className="h-9">
                            {message && (
                                <Text className="py-1" type={messageType}>
                                    {message}
                                </Text>
                            )}
                        </div>

                        {displayButtons && (
                            <>
                                <Button
                                    className="ml-4"
                                    size="sm"
                                    type="primary"
                                    onClick={handleSubmitUploadsClick}
                                >
                                    {errorMessage
                                        ? "Retry Upload"
                                        : `Upload ${files.length} File${
                                              files.length > 1 ? "s" : ""
                                          }`}
                                </Button>
                                <Button
                                    className="ml-4"
                                    type="outline"
                                    onClick={handleCancelUploadsClicks}
                                    size="sm"
                                >
                                    Cancel
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export type NewFilesListProps = {
    newFiles: UploadingFile[];
    removeNewFile: (fileName: string) => void;
    isUploading: boolean;
};

export const NewFilesList = ({
    newFiles,
    removeNewFile,
    isUploading,
}: NewFilesListProps) => {
    return (
        <div className="h-80 overflow-auto p-4">
            {newFiles.map((file, idx) => (
                <div
                    className="flex justify-between border-b-2 border-b-gray-50 p-4 text-right text-sm hover:bg-gray-50"
                    key={`newFile-${idx}`}
                >
                    <div className="break-all text-left">
                        <span className="font-semibold">{file.name}</span> (
                        {Math.ceil(file.size / 1_024).toLocaleString()} Kb)
                    </div>
                    <div>
                        {file.uploadStatus === "pending" ? (
                            <div>Uploading...</div>
                        ) : file.uploadStatus === "success" ? (
                            <div>✅</div>
                        ) : file.uploadStatus === "fail" ? (
                            <div className="text-red-500">⚠️ Failed</div>
                        ) : !isUploading ? (
                            <Button
                                onClick={() => removeNewFile(file.name)}
                                type="icon"
                                size="xs"
                            >
                                ❌
                            </Button>
                        ) : (
                            "Enqueued"
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
};
