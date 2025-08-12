import { ProcessedPackage } from "@/lib/zod/CommonPackage";

import { useAvailablePackages } from "./use-available-packages";
import { useInstalledPackages } from "./use-installed-packages";

interface SemVer {
    major: number;
    minor: number;
    patch: number;
    prerelease?: string;
    build?: string;
}

type ComparisonResult = -1 | 0 | 1;

const compareSemVer = (
    version1: string,
    version2: string,
): ComparisonResult => {
    const v1 = parseSemVer(version1);
    const v2 = parseSemVer(version2);

    if (v1.major !== v2.major) {
        return v1.major < v2.major ? -1 : 1;
    }

    if (v1.minor !== v2.minor) {
        return v1.minor < v2.minor ? -1 : 1;
    }

    if (v1.patch !== v2.patch) {
        return v1.patch < v2.patch ? -1 : 1;
    }

    if (v1.prerelease && !v2.prerelease) {
        return -1;
    }
    if (!v1.prerelease && v2.prerelease) {
        return 1;
    }
    if (v1.prerelease && v2.prerelease && v1.prerelease !== v2.prerelease) {
        return v1.prerelease < v2.prerelease ? -1 : 1;
    }

    return 0;
};

const parseSemVer = (version: string): SemVer => {
    const semverRegex =
        /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?(?:\+([0-9A-Za-z-.]+))?$/;
    const match = version.match(semverRegex);

    if (!match) {
        throw new Error(`Invalid semver version: ${version}`);
    }

    return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        patch: parseInt(match[3], 10),
        prerelease: match[4],
        build: match[5],
    };
};

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
        ...installedPackages.map((x) => x.name),
        ...availablePackages.map((pack) => pack.name),
    ].filter((item, index, arr) => arr.indexOf(item) == index);

    const processed = allPackageNames.map((name): ProcessedPackage => {
        const current = installedPackages.find((pack) => pack.name == name);
        const available = availablePackages.find((pack) => pack.name == name);
        if (current && available) {
            const compared = compareSemVer(available.version, current.version);

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
                        available,
                        current,
                    };
                } else {
                    return {
                        id: current.name,
                        status: "RollBackAvailable",
                        current,
                        rollback: available,
                    };
                }
            }
        } else if (available) {
            return {
                ...available,
                id: available.name,
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

    processed.sort(
        (a, b) => statusPriority[b.status] - statusPriority[a.status],
    );

    return {
        data: processed,
        isLoading: isLoadingAvailablePackages || isLoadingInstalledPackages,
    };
};
