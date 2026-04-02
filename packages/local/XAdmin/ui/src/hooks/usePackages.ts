import { useQuery } from "@tanstack/react-query";

import { getJson } from "@psibase/common-lib";

import { queryKeys } from "@/lib/queryKeys";
import { PackageInfo } from "@/types";

import { graphql } from "@shared/lib/graphql";

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
                "{ installed(first: 100) { edges { node { name version } } } }",
                { service: "x-packages" },
            )) as {
                installed: { edges: { node: InstalledLocalPackage }[] };
            };
            return res.installed.edges.map((e) => e.node);
        },
        initialData: [],
    });
