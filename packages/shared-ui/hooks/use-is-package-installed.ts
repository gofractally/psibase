import { packages, usePluginFunctionQuery } from "@shared/lib/plugins";
import { zInstalledPackageMeta } from "@shared/lib/schemas/installed-package";

type Options = {
    enabled?: boolean;
};

export const useIsPackageInstalled = (
    packageName: string,
    { enabled }: Options = { enabled: true },
) => {
    const result = usePluginFunctionQuery(
        packages.queries.getInstalledPackages,
        [],
        {
            enabled,
        },
    );
    if (!result.data) return result;

    const installedPackages = zInstalledPackageMeta.array().parse(result.data);
    const isInstalled = installedPackages.some(
        (pkg) => pkg.name === packageName,
    );
    return {
        ...result,
        data: isInstalled,
    };
};
