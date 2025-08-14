import { compareSemVer } from "@/lib/semver";
import { ProcessedPackage } from "@/lib/zod/CommonPackage";

import { useAvailablePackages } from "./use-available-packages";
import { useInstalledPackages } from "./use-installed-packages";

export const usePackages = (): {
    isLoading: boolean;
    data: ProcessedPackage[];
} => {
    const {
        data: installedPackagesData,
        isLoading: isLoadingInstalledPackages,
    } = useInstalledPackages();
    const {
        data: availablePackagesData,
        isLoading: isLoadingAvailablePackages,
    } = useAvailablePackages();

    const installedPackages = installedPackagesData || [];
    const availablePackages = availablePackagesData || [];
    const allPackageNames: string[] = [
        ...new Set([
            ...installedPackages.map((pack) => pack.name),
            ...availablePackages.map((pack) => pack.name),
        ]),
    ];

    const processed = allPackageNames.map((name): ProcessedPackage => {
        const current = installedPackages.find((pack) => pack.name == name);
        const latestAvailable = availablePackages
            .filter((pack) => pack.name == name)
            .sort((a, b) => compareSemVer(b.version, a.version))[0];
        if (current && latestAvailable) {
            const compared = compareSemVer(
                latestAvailable.version,
                current.version,
            );

            if (compared == 0) {
                return {
                    id: current.name,
                    ...current,
                    status: "UpToDate",
                };
            } else {
                if (compared == 1) {
                    return {
                        id: current.name,
                        status: "UpdateAvailable",
                        available: latestAvailable,
                        current,
                    };
                } else {
                    return {
                        id: current.name,
                        status: "RollBackAvailable",
                        current,
                        rollback: latestAvailable,
                    };
                }
            }
        } else if (latestAvailable) {
            return {
                ...latestAvailable,
                id: latestAvailable.name,
                status: "Available",
            };
        } else if (current) {
            return {
                ...current,
                id: current.name,
                status: "InstalledButNotAvailable",
            };
        } else {
            throw new Error("Failed to recognise package");
        }
    });

    const statusPriority: Record<string, number> = {
        UpdateAvailable: 5,
        RollBackAvailable: 4,
        Available: 3,
        InstalledButNotAvailable: 2,
        UpToDate: 1,
    };

    processed.sort((a, b) => {
        if (a.status === b.status) {
            return a.id.localeCompare(a.id);
        } else {
            return statusPriority[b.status] - statusPriority[a.status];
        }
    });

    return {
        data: processed,
        isLoading: isLoadingAvailablePackages || isLoadingInstalledPackages,
    };
};
