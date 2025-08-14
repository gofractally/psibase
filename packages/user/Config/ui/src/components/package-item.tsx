import {
    ArrowDownFromLine,
    ArrowUpFromLine,
    CircleCheck,
    LucideShieldQuestion,
} from "lucide-react";

import { ProcessedPackage } from "@/lib/zod/CommonPackage";

import { cn } from "@shared/lib/utils";
import { Checkbox } from "@shared/shadcn/ui/checkbox";

export const PackageItem = ({
    pack,
    isSelected,
    isMutating,
    isLoading,
    onClick,
}: {
    pack: ProcessedPackage;
    isSelected: boolean;
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
            ? "Installed"
            : pack.status == "UpToDate"
              ? "Up to date"
              : pack.status == "UpdateAvailable"
                ? "Update"
                : "Rollback";

    const isDisabled =
        isMutating ||
        pack.status === "UpToDate" ||
        pack.status === "InstalledButNotAvailable";

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
            <div
                className={cn("flex items-center justify-between gap-3", {
                    "text-muted-foreground": pack.status == "UpToDate",
                })}
            >
                <div className="text-sm">{version}</div>
                <button
                    type="button"
                    className={cn(
                        "flex items-center gap-2 rounded-sm border px-3 py-2",
                        { "bg-muted": isSelected },
                    )}
                    onClick={() => {
                        onClick(pack.id);
                    }}
                    disabled={isDisabled}
                >
                    {!isDisabled && <Checkbox checked={isSelected} />}
                    {pack.status === "Available" ||
                    pack.status === "UpdateAvailable" ? (
                        <ArrowUpFromLine className=" h-4 w-4" />
                    ) : pack.status === "RollBackAvailable" ? (
                        <ArrowDownFromLine className=" h-4 w-4" />
                    ) : pack.status === "InstalledButNotAvailable" ? (
                        <LucideShieldQuestion className=" h-4 w-4" />
                    ) : (
                        <CircleCheck className=" h-4 w-4" />
                    )}
                    {buttonLabel}
                </button>
            </div>
        </div>
    );
};
