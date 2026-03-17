import type { PackageInfo } from "@/types";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload } from "lucide-react";
import { useState } from "react";

import { getArrayBuffer } from "@psibase/common-lib";

import { useToast } from "@/components/ui/use-toast";

import {
    useInstalledLocalPackages,
    useLocalPackages,
} from "@/hooks/usePackages";
import { chain } from "@/lib/chainEndpoints";
import { queryKeys } from "@/lib/queryKeys";

import { compareSemVer } from "@shared/lib/semver";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

type LocalPackageStatus = "Available" | "UpToDate" | "UpdateAvailable";

type LocalPackageRow = PackageInfo & {
    status: LocalPackageStatus;
    installedVersion?: string;
};

function mergeLocalPackagesWithInstalled(
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

export const NodeLocalPackages = () => {
    const [file, setFile] = useState<File | null>(null);
    const [isInstalling, setIsInstalling] = useState(false);
    const [installingFileName, setInstallingFileName] = useState<string | null>(
        null,
    );
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { data: localPackages = [], isLoading: isLoadingLocalPackages } =
        useLocalPackages();
    const { data: installedLocal = [], isLoading: isLoadingInstalled } =
        useInstalledLocalPackages();
    const mergedPackages = mergeLocalPackagesWithInstalled(
        localPackages,
        installedLocal,
    );

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = event.target.files?.[0];
        if (selectedFile) {
            if (!selectedFile.name.endsWith(".psi")) {
                toast({
                    title: "Invalid file type",
                    description: "Please select a .psi package file",
                    variant: "destructive",
                });
                return;
            }
            setFile(selectedFile);
        }
    };

    const handleInstall = async () => {
        if (!file) {
            toast({
                title: "No file selected",
                description: "Please select a .psi package file first",
                variant: "destructive",
            });
            return;
        }

        setIsInstalling(true);

        try {
            const result = await chain.installNodeLocalPackage(file);

            if (result.success) {
                toast({
                    title: "Installation successful",
                    description: `Installed ${result.installed.length} service(s): ${result.installed.join(", ")}`,
                });
                setFile(null);
                const fileInput = document.getElementById(
                    "package-file-input",
                ) as HTMLInputElement;
                if (fileInput) fileInput.value = "";
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.installedLocalPackages,
                });
            } else {
                const failedMsg = result.failed
                    ? `Failed: ${result.failed.name} - ${result.failed.error}`
                    : "Unknown error";
                const installedMsg =
                    result.installed.length > 0
                        ? `Installed: ${result.installed.join(", ")}`
                        : "None installed";
                const notAttemptedMsg =
                    result.notAttempted.length > 0
                        ? `Not attempted: ${result.notAttempted.join(", ")}`
                        : "";

                toast({
                    title: "Installation partially failed",
                    description: `${failedMsg}. ${installedMsg}. ${notAttemptedMsg}`,
                    variant: "destructive",
                });
            }
        } catch (error) {
            toast({
                title: "Installation failed",
                description:
                    error instanceof Error
                        ? error.message
                        : "Unknown error occurred",
                variant: "destructive",
            });
        } finally {
            setIsInstalling(false);
        }
    };

    const handleInstallFromList = async (pack: LocalPackageRow) => {
        setInstallingFileName(pack.file);
        try {
            const buffer = await getArrayBuffer(`/packages/${pack.file}`);
            const fileObj = new File([buffer], pack.file, {
                type: "application/zip",
            });
            const result = await chain.installNodeLocalPackage(fileObj);
            if (result.success) {
                toast({
                    title: "Installation successful",
                    description: `Installed ${result.installed.length} service(s): ${result.installed.join(", ")}`,
                });
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.localPackages,
                });
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.installedLocalPackages,
                });
            } else {
                const failedMsg = result.failed
                    ? `Failed: ${result.failed.name} - ${result.failed.error}`
                    : "Unknown error";
                const installedMsg =
                    result.installed.length > 0
                        ? `Installed: ${result.installed.join(", ")}`
                        : "None installed";
                const notAttemptedMsg =
                    result.notAttempted.length > 0
                        ? `Not attempted: ${result.notAttempted.join(", ")}`
                        : "";
                toast({
                    title: "Installation partially failed",
                    description: `${failedMsg}. ${installedMsg}. ${notAttemptedMsg}`,
                    variant: "destructive",
                });
            }
        } catch (error) {
            toast({
                title: "Installation failed",
                description:
                    error instanceof Error
                        ? error.message
                        : "Unknown error occurred",
                variant: "destructive",
            });
        } finally {
            setInstallingFileName(null);
        }
    };

    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-lg font-medium">
                    Install Node-local Package
                </h3>
                <p className="text-muted-foreground text-sm">
                    Upload a .psi package file to install node-local services
                    and data files on this node.
                </p>
            </div>

            <div className="grid w-full max-w-sm items-center gap-1.5">
                <Label htmlFor="package-file-input">Package File (.psi)</Label>
                <Input
                    id="package-file-input"
                    type="file"
                    accept=".psi"
                    onChange={handleFileChange}
                    disabled={isInstalling}
                />
                {file && (
                    <p className="text-muted-foreground text-sm">
                        Selected: {file.name}
                    </p>
                )}
            </div>

            <Button
                onClick={handleInstall}
                disabled={!file || isInstalling}
                className="gap-2"
            >
                {isInstalling ? (
                    <Loader2 size={16} className="animate-spin" />
                ) : (
                    <Upload size={16} />
                )}
                {isInstalling ? "Installing..." : "Install Package"}
            </Button>

            <div className="rounded-lg border p-4 text-sm">
                <h4 className="mb-2 font-medium">Notes:</h4>
                <ul className="text-muted-foreground list-inside list-disc space-y-1">
                    <li>
                        Node-local packages install services directly on this
                        node
                    </li>
                    <li>
                        Packages are not installed atomically, i.e., if
                        installation fails, a partial installation will result
                    </li>
                </ul>
            </div>

            <div className="space-y-2">
                <h3 className="text-lg font-medium">Local packages</h3>
                <p className="text-muted-foreground text-sm">
                    Install a package from the node package directory.
                </p>
                {isLoadingLocalPackages || isLoadingInstalled ? (
                    <div className="text-muted-foreground flex items-center gap-2 text-sm">
                        <Loader2 size={16} className="animate-spin" />
                        Loading…
                    </div>
                ) : mergedPackages.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                        No local packages in index.
                    </p>
                ) : (
                    <div className="flex flex-col gap-2">
                        {mergedPackages.map((row) => {
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
                                        <span className="font-medium">
                                            {row.name}
                                        </span>
                                        {row.installedVersion != null && (
                                            <span className="text-muted-foreground text-sm">
                                                Installed:{" "}
                                                {row.installedVersion}
                                                {row.status ===
                                                    "UpdateAvailable" &&
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
                                        <Button
                                            size="sm"
                                            onClick={() =>
                                                handleInstallFromList(row)
                                            }
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
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
