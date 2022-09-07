import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import wait from "waait";
import Button from "../button";
import Text from "../text";

export type UploadZoneProps = {
    files: File[];
    onChangeFiles: (newFiles: File[]) => void;
    onSubmitUploads: () => Promise<void>;
};

export const UploadZone = ({
    files,
    onChangeFiles,
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

    const displayControls = files.length > 0 || successMessage || errorMessage;
    const displayButtons = !messageType || messageType === "danger";

    return !displayControls ? (
        <div {...getRootProps()}>
            <input {...getInputProps()} />
            <div className="text-r border-2 border-dashed border-gray-200 p-4">
                Drop Files or Click here to Upload
            </div>
        </div>
    ) : (
        <div>
            <NewFilesList newFiles={files} />
            <div className="mt-2 text-right">
                {message && (
                    <Text type={messageType} size="sm">
                        {message}
                    </Text>
                )}
                {displayButtons && (
                    <>
                        <Button
                            size="sm"
                            type="primary"
                            onClick={handleSubmitUploadsClick}
                        >
                            Upload {files.length} File
                            {files.length > 1 ? "s" : ""}
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
    );
};

export type NewFilesListProps = {
    newFiles: File[];
};

export const NewFilesList = ({ newFiles }: NewFilesListProps) => {
    return (
        <div className="text-right text-sm">
            {newFiles.map((file, idx) => (
                <span className="ml-4" key={`newFile-${idx}`}>
                    <span className="font-bold">{file.name}</span> (
                    {Math.ceil(file.size / 1_000).toLocaleString()} Kb)
                </span>
            ))}
        </div>
    );
};
