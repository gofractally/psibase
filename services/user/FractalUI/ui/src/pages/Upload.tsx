import { ChevronRight, File, Folder, Pencil, Trash } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
} from "@/components/ui/sidebar";

import { EmptyBlock } from "@/components/EmptyBlock";
import { FileUploader } from "@/components/file-uploader";

import { useRemovePath } from "@/hooks/use-remove-path";
import { useCurrentFractal } from "@/hooks/useCurrentFractal";
import { useSiteConfig } from "@/hooks/useSiteConfig";
import { cn } from "@/lib/utils";
import { Account, Path } from "@/lib/zodTypes";

// @ts-ignore
function Tree({
    item,
    isFolder = false,
    path = "", // The path is passed down for folder selection
    onSelection, // Callback function for when a folder is selected
    selectedPath, // Whether this item is selected or not
    onDelete, // Add new prop
}: {
    item: string | any[];
    isFolder: boolean;
    path: string;
    onSelection: (selectedPath: string) => void;
    selectedPath: string;
    onDelete?: (path: string) => void; // Add new prop type
}) {
    const [name, ...items] = Array.isArray(item) ? item : [item];

    const fullPath = path + "/" + name;

    const isRoot = name == "-Root";

    const handleSelection = () => {
        if (isFolder && onSelection) {
            onSelection(fullPath);
        }
    };

    const isSelected = selectedPath == fullPath;

    if (!items.length) {
        return (
            <SidebarMenuButton
                isActive={isSelected}
                className={cn(
                    `flex list-none items-center justify-between data-[active=true]:bg-transparent`,
                    {
                        "bg-blue-500 text-white": isSelected,
                        italic: isRoot,
                    },
                )}
                onClick={handleSelection}
            >
                <div className="flex items-center">
                    {isFolder ? <Folder /> : <File />}
                    {isRoot ? "Root" : name}
                </div>
                {!isFolder && !isRoot && onDelete && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(fullPath);
                        }}
                    >
                        <Trash className="h-4 w-4" />
                    </Button>
                )}
            </SidebarMenuButton>
        );
    }

    return (
        <SidebarMenuItem className="list-none">
            <Collapsible
                className="group/collapsible list-none [&[data-state=open]>button>svg:first-child]:rotate-90"
                defaultOpen={name === "components" || name === "ui"}
            >
                <CollapsibleTrigger asChild>
                    <SidebarMenuButton onClick={handleSelection}>
                        <ChevronRight className="transition-transform" />
                        <Folder />
                        {name}
                    </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <SidebarMenuSub>
                        {items.map((subItem, index) => (
                            <Tree
                                key={index}
                                item={subItem}
                                isFolder={isFolder}
                                path={`${path}/${name}`}
                                onSelection={onSelection}
                                selectedPath={selectedPath}
                                onDelete={onDelete}
                            />
                        ))}
                    </SidebarMenuSub>
                </CollapsibleContent>
            </Collapsible>
        </SidebarMenuItem>
    );
}

type Node = string | [string, ...Node[]];

type Path = string;

const convertToNestedArray = (obj: Record<string, any>, name: string): Node => {
    const children = Object.entries(obj).map(([key, value]) =>
        convertToNestedArray(value, key),
    );
    return children.length ? [name, ...children] : name;
};

const buildTreeFolderAndFiles = (paths: Path[]): Node[] => {
    const root: Record<string, any> = {};

    for (const path of paths) {
        const parts = path.split("/").filter(Boolean);
        let current = root;

        for (const part of parts) {
            if (!current[part]) {
                current[part] = {};
            }
            current = current[part];
        }
    }

    return Object.entries(root).map(([key, value]) =>
        convertToNestedArray(value, key),
    );
};

const buildTreeFoldersOnly = (paths: Path[]): Node[] => {
    const root: Record<string, any> = {};

    for (const path of paths) {
        const parts = path.split("/").filter(Boolean);
        let current = root;

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!current[part]) {
                current[part] = {};
            }
            current = current[part];
        }
    }

    return Object.entries(root).map(([key, value]) =>
        convertToNestedArray(value, key),
    );
};

export const Upload = () => {
    const currentFractal = useCurrentFractal();
    const { data } = useSiteConfig(currentFractal);
    const removePath = useRemovePath();

    const paths = data
        ? data.getContent.edges.map((edge) => edge.node.path)
        : [];

    const isEmpty = paths.length == 0;

    const treeFolderAndFiles = data ? buildTreeFolderAndFiles(paths) : [];
    const treeFoldersOnly = data ? buildTreeFoldersOnly(paths) : [];

    const [showModal, setModal] = useState(false);
    const [selectedPath, setSelectedPath] = useState<string | null>(null);

    const normalizedPath = selectedPath == "/-Root" ? "/" : selectedPath || "/";

    const handleFolderSelection = (path: string) => {
        setSelectedPath(path);
    };

    const [uploadPath, setUploadPath] = useState("/");

    useEffect(() => {
        setUploadPath(normalizedPath || "");
    }, [normalizedPath]);

    const handleDelete = (path: string) => {
        if (confirm(`Are you sure you want to delete ${path}?`)) {
            removePath.mutate({
                account: Account.parse(currentFractal),
                path: path,
            });
        }
    };

    return (
        <div className="mx-auto grid w-full max-w-screen-xl list-none  grid-cols-1 gap-8 p-4">
            <Dialog
                open={showModal}
                onOpenChange={(e) => {
                    setModal(e);
                }}
            >
                <DialogContent>
                    <div className="text-lg">Select directory</div>
                    <Tree
                        isFolder={true}
                        item={"-Root"}
                        path="" // Start with an empty path for root items
                        onSelection={handleFolderSelection} // Pass down the selection handler
                        selectedPath={selectedPath || ""} // Check if this item is selected
                    />
                    {treeFoldersOnly.map((subItem, index) => (
                        <Tree
                            isFolder={true}
                            key={index}
                            item={subItem}
                            path="" // Start with an empty path for root items
                            onSelection={handleFolderSelection} // Pass down the selection handler
                            selectedPath={selectedPath || ""} // Check if this item is selected
                        />
                    ))}

                    <div className="flex flex-col gap-2">
                        <div className="text-sm text-muted-foreground">
                            Upload directory:
                        </div>
                        <div className="flex items-center justify-between gap-1 text-sm font-medium leading-none">
                            {uploadPath}{" "}
                            <Button
                                variant="ghost"
                                onClick={() => {
                                    setUploadPath(
                                        Path.parse(
                                            window.prompt("Upload Path") ||
                                                normalizedPath ||
                                                "",
                                        ),
                                    );
                                }}
                            >
                                <Pencil className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                    <div>
                        <FileUploader
                            onSuccess={(files) => {
                                toast(
                                    `Uploaded ${
                                        files.length == 1
                                            ? files[0]
                                            : `${files.length} files`
                                    }`,
                                );
                                setModal(false);
                            }}
                            pathPrefix={uploadPath}
                        />
                    </div>
                </DialogContent>
            </Dialog>
            <div className="flex justify-between">
                <div className="flex flex-col gap-3">
                    <h1 className="text-lg font-semibold">Upload Files</h1>
                </div>
                <Button
                    onClick={() => {
                        setModal(true);
                    }}
                >
                    Upload
                </Button>
            </div>
            <div>
                {isEmpty ? (
                    <EmptyBlock
                        title="No files yet"
                        onButtonClick={() => {
                            setModal(true);
                        }}
                        description="This service has no files uploaded"
                        buttonLabel="Upload"
                    />
                ) : (
                    treeFolderAndFiles.map((subItem, index) => (
                        <Tree
                            isFolder={false}
                            key={index}
                            item={subItem}
                            path="" // Start with an empty path for root items
                            onSelection={handleFolderSelection} // Pass down the selection handler
                            selectedPath={selectedPath || ""}
                            onDelete={handleDelete}
                        />
                    ))
                )}
            </div>
        </div>
    );
};
