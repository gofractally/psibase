import {
    ArrowDownFromLine,
    ArrowUpFromLine,
    CircleCheck,
    LucideShieldQuestion,
} from "lucide-react";

import { ProcessedPackage } from "@/lib/zod/CommonPackage";

import { Button } from "@shared/shadcn/ui/button";

export const PackageItem = ({
    pack,
    isMutating,
    isLoading,
    onClick,
}: {
    pack: ProcessedPackage;
    isMutating: boolean;
    isLoading: boolean;
    onClick: (id: string) => void;
}) => {
    let version: string = "";
    if (pack.status == "UpdateAvailable") {
        version = pack.available.version;
    } else if (pack.status == "RollBackAvailable") {
        version = `${pack.current.version} -> ${pack.rollback}`;
    } else {
        version = pack.version;
    }

    const buttonLabel = isMutating
        ? "Processing"
        : pack.status == "Available"
          ? "Install"
          : pack.status == "InstalledButNotAvailable"
            ? ""
            : pack.status == "UpToDate"
              ? "Up to date"
              : pack.status == "UpdateAvailable"
                ? "Update"
                : "Rollback";

    const isDisabled =
        isMutating ||
        pack.status === "UpToDate" ||
        pack.status === "InstalledButNotAvailable";
    const buttonVariant =
        pack.status === "RollBackAvailable" ? "destructive" : "secondary";

    const description =
        pack.status === "Available"
            ? pack.description
            : pack.status == "RollBackAvailable"
              ? pack.rollback.description
              : pack.status == "UpdateAvailable"
                ? pack.available.description
                : pack.description;

    if (isLoading) {
        return <div> Loading </div>;
    }

    return (
        <div className="flex justify-between rounded-sm border p-2">
            <div className="flex  flex-col">
                <div>{pack.id}</div>
                <div className="text-muted-foreground text-sm">
                    {description}
                </div>
            </div>
            <div className=" flex items-center justify-between gap-3">
                <div>{version}</div>
                <Button
                    onClick={() => {
                        onClick(pack.id);
                    }}
                    variant={buttonVariant}
                    size="sm"
                    disabled={isDisabled}
                >
                    {pack.status === "Available" ||
                    pack.status === "UpdateAvailable" ? (
                        <ArrowUpFromLine className="mr-2 h-4 w-4" />
                    ) : pack.status === "RollBackAvailable" ? (
                        <ArrowDownFromLine className="mr-2 h-4 w-4" />
                    ) : pack.status === "InstalledButNotAvailable" ? (
                        <LucideShieldQuestion className="mr-2 h-4 w-4" />
                    ) : (
                        <CircleCheck className="mr-2 h-4 w-4" />
                    )}
                    {buttonLabel}
                </Button>
            </div>
        </div>
    );
};
