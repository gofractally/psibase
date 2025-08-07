import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";
import { getJson, postGraphQLGetJson, siblingUrl } from "@psibase/common-lib";

import QueryKey from "@/lib/queryKeys";
import { PackageSchema } from "@/lib/zod/CommonPackage";

export const zPackageSchemaWithSha = PackageSchema.extend({
    file: z.string(),
    sha256: z.string(),
});

export type PackageSchemaWithSha = z.infer<typeof zPackageSchemaWithSha>;

async function readPackageIndexGQL(url: string, account: string) {
    let cursorArg = "";
    let done = false;
    const result = [];
    while (!done) {
        const query = `query { packages(owner: "${account}", first: 100${cursorArg}) { pageInfo { hasNextPage endCursor } edges { node { name version description depends { name version } accounts sha256 file } } } }`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const page = await postGraphQLGetJson<any>(
            url.replace(/\/?$/, "/graphql"),
            query,
        );
        console.log(page, "is the page");

        for (const edge of page.data.packages.edges) {
            result.push(edge.node);
        }
        cursorArg = `, after: "${page.data.packages.pageInfo.endCursor}"`;
        done = !page.data.packages.pageInfo.hasNextPage;
    }
    return zPackageSchemaWithSha.array().parse(result);
}

export const zPackageRepo = z.object({
    baseUrl: z.string().url(),
    index: z.array(zPackageSchemaWithSha),
});

export type PackageRepo = z.infer<typeof zPackageRepo>;

export async function getPackageIndex(owner: string) {
    let sources = await supervisor.functionCall({
        service: "packages",
        intf: "queries",
        method: "getSources",
        params: [owner],
    });
    if (sources.length == 0) {
        sources = [{ url: siblingUrl(null, "x-admin", "/packages") }];
    }
    const result = [];
    for (const source of sources) {
        if (source.account) {
            const url = source.url || siblingUrl(null, null, "/");
            const packagesUrl = new URL(url);
            packagesUrl.hostname = `packages.${packagesUrl.hostname}`;
            const index = await readPackageIndexGQL(
                packagesUrl.toString(),
                source.account,
            );
            const baseUrl = new URL(url);
            baseUrl.hostname = `${source.account}.${baseUrl.hostname}`;
            result.push({ baseUrl: baseUrl.toString(), index });
        } else if (source.url) {
            const url = source.url.replace(/\/?$/, "/index.json");
            const index = await getJson<PackageSchemaWithSha[]>(url);
            result.push({ baseUrl: url, index });
        } else {
            console.log("Skipping invalid package source");
        }
    }
    return zPackageRepo.array().parse(result);
}

export const useAvailablePackages = () =>
    useQuery({
        queryKey: QueryKey.availablePackages(),
        queryFn: async () => {
            return (await getPackageIndex("root")).flatMap((x) => x.index);
        },
    });
