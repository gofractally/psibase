interface SemVer {
    major: number;
    minor: number;
    patch: number;
    prerelease?: string;
    build?: string;
}

type ComparisonResult = -1 | 0 | 1;

export const compareSemVer = (
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
