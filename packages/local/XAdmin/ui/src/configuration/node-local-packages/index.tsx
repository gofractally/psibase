import { useStatuses } from "@/hooks/use-statuses";

import { PackagesReady } from "./packages-ready";
import { PackagesUnbooted } from "./packages-unbooted";

export const NodeLocalPackages = () => {
    const { data: status } = useStatuses();
    if (status?.includes("needgenesis")) {
        return <PackagesUnbooted />;
    }
    return <PackagesReady />;
};
