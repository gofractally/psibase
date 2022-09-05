import { useMemo } from "react";

export type PathBreadcrumbsProps = {
    account: string;
    path: string;
    onPathChange: (newPath: string) => void;
};

export const PathBreadcrumbs = ({
    account,
    path,
    onPathChange,
}: PathBreadcrumbsProps) => {
    if (path === "/") {
        return (
            <>
                <span>{account}</span>
                <span className="mx-1">/</span>
            </>
        );
    }

    const breadcrumbs = useMemo(() => {
        const folders = path.split("/");
        const items = [];
        const currentFolderIndex = folders.length - 2;
        let pathLink = "";

        for (let i = 0; i <= currentFolderIndex; i++) {
            const currentFolder = folders[i];
            pathLink += `${currentFolder}/`;

            const newItem = (
                <FolderBreadcrumb
                    key={`fb-${i}`}
                    onClick={onPathChange}
                    pathLink={i < currentFolderIndex ? pathLink : undefined}
                    label={i !== 0 ? currentFolder : account}
                />
            );

            const separator = <BreadcrumbSeparator key={`sep-${i}`} />;

            items.push(newItem, separator);
        }

        return items;
    }, [path]);

    return <>{breadcrumbs}</>;
};

export type FolderBreadcrumbProps = {
    pathLink?: string;
    onClick: (newVal: string) => void;
    label: string;
};

export const FolderBreadcrumb = ({
    pathLink,
    onClick,
    label,
}: FolderBreadcrumbProps) => {
    return pathLink ? (
        <a
            href="#"
            onClick={() => {
                onClick(pathLink);
            }}
        >
            {label}
        </a>
    ) : (
        <span>{label}</span>
    );
};

export const BreadcrumbSeparator = () => <span className="mx-1">/</span>;
