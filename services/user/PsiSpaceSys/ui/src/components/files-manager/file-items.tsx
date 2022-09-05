export type FileItemProps = {
    name: string;
    isFolder?: boolean;
    type?: string;
    onClick: () => void;
};

export const FileItem = ({ name, onClick, isFolder, type }: FileItemProps) => {
    let className =
        "cursor-pointer border-b-2 border-b-gray-200 p-4 hover:bg-gray-50";

    if (isFolder) {
        className += " font-bold";
    }

    return (
        <div onClick={onClick} className={className}>
            <FileTypeIcon type={isFolder ? "folder" : type} />
            {name}
            {isFolder && "/"}
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
