import { useQuery } from "@tanstack/react-query";

import { fetchInstalledPackages } from "@/lib/queries";

/** True when the Docs package is installed on this chain. */
export const useDocsInstalled = (): boolean => {
    const { data } = useQuery({
        queryKey: ["packages", "installed"],
        queryFn: fetchInstalledPackages,
        staleTime: 5 * 60_000,
    });
    return (
        data?.some(
            (p) =>
                p.name === "Docs" ||
                p.accounts.includes("docs") ||
                p.services.includes("docs"),
        ) ?? false
    );
};
