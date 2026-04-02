import { useQuery } from "@tanstack/react-query";

import { getJson } from "@psibase/common-lib";

import { graphql } from "@/lib/graphql";
import { queryKeys } from "@/lib/queryKeys";
import { PackageInfo } from "@/types";

export const usePackages = () =>
    useQuery<PackageInfo[]>({
        queryKey: queryKeys.packages,
        queryFn: () => getJson("/packages/index.json"),
        initialData: [],
    });

export const useLocalPackages = () =>
    useQuery<PackageInfo[]>({
        queryKey: queryKeys.localPackages,
        queryFn: async () => {
            const index = await getJson<PackageInfo[]>("/packages/index.json");
            return (index ?? []).filter((p) => p.scope === "local");
        },
        initialData: [],
    });

export type InstalledLocalPackage = { name: string; version: string };

export const useInstalledLocalPackages = () =>
    useQuery<InstalledLocalPackage[]>({
        queryKey: queryKeys.installedLocalPackages,
        queryFn: async () => {
            const res = (await graphql(
                "query { installed(first: 100) { edges { node { name version } } } }",
                "x-packages",
            )) as {
                data: {
                    installed: { edges: { node: InstalledLocalPackage }[] };
                };
            };
            return res.data.installed.edges.map((e) => e.node);
        },
        initialData: [],
    });
