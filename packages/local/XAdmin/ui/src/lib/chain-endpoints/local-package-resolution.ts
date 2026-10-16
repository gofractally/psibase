import { packages as packageInterface } from "wasm-transpiled";

import { getJson, siblingUrl } from "@psibase/common-lib";

import { adminGraphql } from "../admin-graphql";
import { adminBearerAuthHeaders } from "../admin-login-jwt";

import type { PackageMeta } from "./package-extraction";

const PACKAGE_RESOLUTION_FIELDS = `
    depends { name version }
    accounts
    services
    exports { name service }
`;

type LocalInstalledNode = {
    name: string;
    version: string;
    description: string;
    sha256: string;
    depends: { name: string; version: string }[];
    accounts: string[];
    services: string[];
    exports: { name: string; service: string }[];
};

type NetworkInstalledNode = LocalInstalledNode & {
    owner: string;
};

async function fetchInstalledForResolution(
    service: "x-packages" | "packages",
    extraFields: string,
): Promise<LocalInstalledNode[] | NetworkInstalledNode[]> {
    const res = (await adminGraphql(
        `{ installed(first: 100) { edges { node { name version description ${extraFields} ${PACKAGE_RESOLUTION_FIELDS} } } } }`,
        { service },
    )) as {
        installed: {
            edges: { node: LocalInstalledNode | NetworkInstalledNode }[];
        };
    };
    return res.installed.edges.map((edge) => edge.node);
}

function fetchLocalInstalledForResolution(): Promise<LocalInstalledNode[]> {
    return fetchInstalledForResolution("x-packages", "sha256") as Promise<
        LocalInstalledNode[]
    >;
}

function fetchNetworkInstalledForResolution(): Promise<NetworkInstalledNode[]> {
    return fetchInstalledForResolution("packages", "owner") as Promise<
        NetworkInstalledNode[]
    >;
}

function checkLocalUploadNetworkDeps(
    indexJson: string,
    packageMeta: PackageMeta,
    localInstalled: LocalInstalledNode[],
    networkInstalled: NetworkInstalledNode[],
): void {
    packageInterface.checkLocalUploadNetworkDeps(
        indexJson,
        JSON.stringify(packageMeta),
        JSON.stringify(localInstalled),
        JSON.stringify(networkInstalled),
    );
}

export type LocalUploadResolutionContext = {
    localInstalled: LocalInstalledNode[];
    networkInstalled: NetworkInstalledNode[];
};

export async function prepareLocalUploadResolution(
    packageMeta: PackageMeta,
): Promise<LocalUploadResolutionContext> {
    const index = await getJson<unknown[]>("/packages/index.json");
    const indexJson = JSON.stringify(index);
    const localInstalled = await fetchLocalInstalledForResolution();
    const localInstalledJson = JSON.stringify(localInstalled);
    const needsNetworkInstalled = packageInterface.localUploadNeedsNetworkInstalled(
        indexJson,
        JSON.stringify(packageMeta),
        localInstalledJson,
    );
    const networkInstalled = needsNetworkInstalled
        ? await fetchNetworkInstalledForResolution()
        : [];

    checkLocalUploadNetworkDeps(
        indexJson,
        packageMeta,
        localInstalled,
        networkInstalled,
    );

    return { localInstalled, networkInstalled };
}

type DynLdLinkRequest = {
    service: string;
    group: string;
    deps: { name: string; service: string }[];
};

export async function linkLocalUploadDynLd(
    packageBytes: Uint8Array,
    resolution: LocalUploadResolutionContext,
): Promise<void> {
    const linksJson = packageInterface.localUploadDynLdLinks(
        packageBytes,
        JSON.stringify(resolution.localInstalled),
        JSON.stringify(resolution.networkInstalled),
    );
    const links = JSON.parse(linksJson) as DynLdLinkRequest[];
    const authHeaders = await adminBearerAuthHeaders();

    for (const link of links) {
        const response = await fetch(siblingUrl(null, "x-dyn-ld", "/link"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...authHeaders,
            },
            body: JSON.stringify(link),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                `Failed to link plugin imports for ${link.service}: ${response.status} ${errorText}`,
            );
        }
    }
}
