import { PageHeading } from "@/components/page-heading";
import { useLocalPackages } from "@/hooks/use-packages";

import {
    LocalPackageList,
    mergeLocalPackagesWithInstalled,
} from "./local-package-list";

export const PackagesUnbooted = () => {
    const { data: localPackages = [], isLoading } = useLocalPackages();
    const packages = mergeLocalPackagesWithInstalled(localPackages, []);

    return (
        <div className="space-y-4">
            <PageHeading
                title="Packages"
                description="Install node-local services and data files on this node."
            />
            <p className="text-muted-foreground text-sm">
                Package install requires a running chain.
            </p>
            <LocalPackageList packages={packages} isLoading={isLoading} />
        </div>
    );
};
