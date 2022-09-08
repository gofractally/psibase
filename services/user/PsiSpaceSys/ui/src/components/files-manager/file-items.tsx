import { useState } from "react";
import Button from "../button";

export type FileItemProps = {
    name: string;
    isFolder?: boolean;
    type?: string;
    onClick: () => void;
    onRemoveClick: () => Promise<void>;
};

export const FileItem = ({
    name,
    onClick,
    isFolder,
    type,
    onRemoveClick,
}: FileItemProps) => {
    const [isConfirmingDeletion, setIsConfirmingDeletion] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");

    const handleConfirmDeletionClick = async (
        e: React.MouseEvent<HTMLButtonElement, MouseEvent>
    ) => {
        e.stopPropagation();
        setErrorMessage("");
        setIsDeleting(true);
        try {
            await onRemoveClick();
        } catch (e) {
            setErrorMessage((e as Error).message || "Fail to delete");
            setIsDeleting(false);
        }
    };

    const handleRemoveClick = async (
        e: React.MouseEvent<HTMLButtonElement, MouseEvent>
    ) => {
        e.stopPropagation();
        setIsConfirmingDeletion(true);
    };

    const handleCancelDeletionClick = async (
        e: React.MouseEvent<HTMLButtonElement, MouseEvent>
    ) => {
        e.stopPropagation();
        setIsConfirmingDeletion(false);
    };

    return (
        <div
            onClick={onClick}
            className={
                "flex cursor-pointer justify-between border-b-2 border-b-gray-50 p-4 hover:bg-gray-50"
            }
        >
            <div className={isFolder ? "font-semibold" : ""}>
                <FileTypeIcon type={isFolder ? "folder" : type} />
                {name}
                {isFolder && "/"}
            </div>
            <div>
                {isDeleting ? (
                    "Deleting..."
                ) : errorMessage ? (
                    <div>
                        <span className="text-red-500">{errorMessage}</span>
                        <Button
                            className="ml-4"
                            type="outline"
                            onClick={handleConfirmDeletionClick}
                        >
                            Retry
                        </Button>
                    </div>
                ) : isConfirmingDeletion ? (
                    <div>
                        Are you sure you want to delete?{" "}
                        <Button
                            className="ml-4"
                            type="icon"
                            onClick={handleConfirmDeletionClick}
                        >
                            Yes
                        </Button>
                        <Button
                            className="ml-4"
                            type="icon"
                            onClick={handleCancelDeletionClick}
                        >
                            No
                        </Button>
                    </div>
                ) : (
                    <Button type="icon" onClick={handleRemoveClick}>
                        🗑️
                    </Button>
                )}
            </div>
        </div>
    );
};

export type FileTypeIconProps = {
    type?: string;
};

export const FileTypeIcon = ({ type }: FileTypeIconProps) => {
    let emojiIcon = "📄";

    if (type !== undefined) {
        switch (type) {
            case "folder":
                emojiIcon = "📁";
                break;
            case "text/html":
            case "text/plain":
                emojiIcon = "📃";
                break;
            case "text/csv":
            case "application/vnd.ms-excel":
            case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                emojiIcon = "📊";
                break;
            case "text/calendar":
                emojiIcon = "📅";
                break;
            case "application/pdf":
                emojiIcon = "📑";
                break;
            case "application/javascript":
            case "application/json":
                emojiIcon = "📜";
                break;
            case "text/css":
                emojiIcon = "🎨";
                break;
            default:
                if (type.startsWith("image")) {
                    emojiIcon = "🖼️";
                } else if (type.startsWith("video")) {
                    emojiIcon = "📽️";
                } else if (type.startsWith("audio")) {
                    emojiIcon = "🔉";
                } else if (type.startsWith("font")) {
                    emojiIcon = "🔠";
                }
        }
    }

    return <span className="mr-2">{emojiIcon}</span>;
};
