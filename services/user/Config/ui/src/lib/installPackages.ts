import { supervisor } from "@/supervisor";
import {
    getArrayBuffer,
    getJson,
    postGraphQLGetJson,
    siblingUrl,
} from "@psibase/common-lib";

type PackageOp = {
    old?: any;
    new?: PackageInfo;
};

type PackageInstallOp = {
    old?: any;
    new?: ArrayBuffer;
};

type PackageRef = {
    name: string;
    version: string;
};

type PackageInfo = {
    name: string;
    version: string;
    description: string;
    depends: PackageRef[];
    accounts: string[];
    sha256: string;
    file: string;
};

type PackageRepo = {
    baseUrl: string;
    index: PackageInfo[];
};

function flattenPackageIndex(index: PackageRepo[]): PackageInfo[] {
    return index.flatMap((repo) =>
        repo.index.map((info) => ({
            ...info,
            file: new URL(info.file, repo.baseUrl).toString(),
        })),
    );
}

async function loadPackages(ops: PackageOp[]): Promise<PackageInstallOp[]> {
    return await Promise.all(
        ops.map(async (op) => {
            if (op.new) {
                return { old: op.old, new: await getArrayBuffer(op.new.file) };
            } else {
                return { old: op.old };
            }
        }),
    );
}

export async function installPackages(
    owner: string,
    packages: string[],
    request_pref: string,
    non_request_pref: string,
) {
    const index = flattenPackageIndex(await getPackageIndex(owner));
    const resolved = (await supervisor.functionCall({
        service: "packages",
        intf: "privateApi",
        method: "resolve",
        params: [index, packages, request_pref, non_request_pref],
    })) as PackageOp[];
    const ops = await loadPackages(resolved);
    const [data, install] = (await supervisor.functionCall({
        service: "packages",
        intf: "privateApi",
        method: "buildTransactions",
        params: [owner, ops, 4],
    })) as [ArrayBuffer[], ArrayBuffer[]];
    for (const tx of data) {
        await supervisor.functionCall({
            service: "packages",
            intf: "privateApi",
            method: "pushData",
            params: [tx],
        });
    }
    for (const tx of install) {
        await supervisor.functionCall({
            service: "packages",
            intf: "privateApi",
            method: "proposeInstall",
            params: [tx],
        });
    }
}

async function readPackageIndexGQL(
    url: string,
    account: string,
): Promise<PackageInfo[]> {
    let cursorArg = "";
    let done = false;
    const result: PackageInfo[] = [];
    while (!done) {
        const query = `query { packages(owner: "${account}", first: 100${cursorArg}) { pageInfo { hasNextPage endCursor } edges { node { name version description depends { name version } accounts sha256 file } } } }`;
        const page = await postGraphQLGetJson<any>(
            url.replace(/\/?$/, "/graphql"),
            query,
        );
        for (const edge of page.data.packages.edges) {
            result.push(edge.node);
        }
        cursorArg = `, after: "${page.data.packages.pageInfo.endCursor}"`;
        done = !page.data.packages.pageInfo.hasNextPage;
    }
    return result;
}

export async function getPackageIndex(owner: string): Promise<PackageRepo[]> {
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
            const index = await getJson<PackageInfo[]>(url);
            result.push({ baseUrl: url, index });
        } else {
            console.log("Skipping invalid package source");
        }
    }
    return result;
}
