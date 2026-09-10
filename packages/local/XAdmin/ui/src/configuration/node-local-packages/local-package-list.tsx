import type { PackageInfo } from "@/types";

import { Loader2 } from "lucide-react";

import { compareSemVer } from "@shared/lib/semver";
import { Button } from "@shared/shadcn/ui/button";

type LocalPackageStatus = "Available" | "UpToDate" | "UpdateAvailable";

export type LocalPackageRow = PackageInfo & {
    status: LocalPackageStatus;
    installedVersion?: string;
};

export function mergeLocalPackagesWithInstalled(
    localPackages: PackageInfo[],
    installed: { name: string; version: string }[],
): LocalPackageRow[] {
    const byName = new Map(installed.map((p) => [p.name, p.version]));
    return localPackages.map((pack) => {
        const installedVersion = byName.get(pack.name);
        if (!installedVersion) {
            return { ...pack, status: "Available" as const };
        }
        const cmp = compareSemVer(pack.version, installedVersion);
        if (cmp === 0) {
            return { ...pack, status: "UpToDate" as const, installedVersion };
        }
        if (cmp > 0) {
            return {
                ...pack,
                status: "UpdateAvailable" as const,
                installedVersion,
            };
        }
        return { ...pack, status: "UpToDate" as const, installedVersion };
    });
}

export const LocalPackageList = ({
    packages,
    isLoading,
    description,
    installingFileName,
    onInstall,
}: {
    packages: LocalPackageRow[];
    isLoading: boolean;
    description?: string;
    installingFileName?: string | null;
    onInstall?: (row: LocalPackageRow) => void;
}) => (
    <div className="space-y-2">
        <h3 className="text-lg font-medium">Local packages</h3>
        {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
        )}
        {isLoading ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 size={16} className="animate-spin" />
                Loading…
            </div>
        ) : packages.length === 0 ? (
            <p className="text-muted-foreground text-sm">
                No local packages in index.
            </p>
        ) : (
            <div className="flex flex-col gap-2">
                {packages.map((row) => {
                    const buttonLabel =
                        row.status === "Available"
                            ? "Install"
                            : row.status === "UpdateAvailable"
                              ? "Update"
                              : "Up to date";
                    const isDisabled =
                        installingFileName === row.file ||
                        row.status === "UpToDate";
                    return (
                        <div
                            key={`${row.name}-${row.version}`}
                            className="flex justify-between rounded-sm border p-2"
                        >
                            <div className="flex flex-col gap-0.5">
                                <span className="font-medium">{row.name}</span>
                                {row.installedVersion != null && (
                                    <span className="text-muted-foreground text-sm">
                                        Installed: {row.installedVersion}
                                        {row.status === "UpdateAvailable" &&
                                            " · Update available"}
                                    </span>
                                )}
                                {row.description && (
                                    <span className="text-muted-foreground text-sm">
                                        {row.description}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-3">
                                <span
                                    className={
                                        row.status === "UpToDate"
                                            ? "text-muted-foreground text-sm"
                                            : "text-sm"
                                    }
                                >
                                    {row.version}
                                </span>
                                {onInstall && (
                                    <Button
                                        size="sm"
                                        onClick={() => onInstall(row)}
                                        disabled={isDisabled}
                                        className="gap-2"
                                    >
                                        {installingFileName === row.file ? (
                                            <Loader2
                                                size={14}
                                                className="animate-spin"
                                            />
                                        ) : null}
                                        {installingFileName === row.file
                                            ? "Installing…"
                                            : buttonLabel}
                                    </Button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        )}
    </div>
);
