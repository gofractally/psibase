import { type SidebarVisibility } from "@/app-config";

import { useIsPackageInstalled } from "@shared/hooks/use-is-package-installed";

export const EXPLORER_PACKAGE_NAME = "Explorer";

/**
 * The Explorer is a standalone app on its own subdomain; it is only featured
 * on the homepage when its package is installed on the chain.
 */
export function useExplorerVisibility(): SidebarVisibility {
    const { data: isInstalled, isPending } = useIsPackageInstalled(
        EXPLORER_PACKAGE_NAME,
    );

    if (isPending) {
        return { visible: false, isLoading: true };
    }

    return { visible: isInstalled === true, isLoading: false };
}
