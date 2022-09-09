import { postGraphQLGetJson } from "common/rpc.mjs";
import { useEffect, useMemo, useState } from "react";
import wait from "waait";
import { useGraphQLQuery } from "./helpers";

export const getContentQuery = (account = "") => {
    account = "psispace-sys";
    console.info("querying acc >>", account);
    if (account) {
        return `
        {
          content(
            ge: {account: "${account}", path: "/"}, 
            le: {account: "${account}", path: "0"}
          ) {
            edges {
              node {
                path
                contentType
              }
            }
          }
        }`;
    } else {
        return "";
    }
};

export type QueryEdge = {
    node: AccountFile;
};

export type AccountFile = {
    path: string;
    contentType: string;
};

const mapQueryResultToAccountFiles = (result: any): AccountFile[] => {
    const edges: QueryEdge[] = result?.data?.content?.edges || [];
    const accountFiles = edges.map((fileEdge: QueryEdge) => ({
        ...fileEdge.node,
    }));
    return accountFiles;
};

export const useFilesForAccount = (
    account?: string
): { accountFiles: AccountFile[]; refreshFiles: () => unknown } => {
    const [accountFiles, setAccountFiles] = useState<AccountFile[]>([]);
    const query = useMemo(() => getContentQuery(account), [account]);
    const [result, invalidateQuery] = useGraphQLQuery("/graphql", query);

    useEffect(() => {
        const newAccountFiles = mapQueryResultToAccountFiles(result);
        setAccountFiles(newAccountFiles);
    }, [result]);

    return { accountFiles, refreshFiles: invalidateQuery };
};

export const pollForUploadedFiles = async (
    account: string,
    path: string,
    files: string[],
    attempt = 1
): Promise<string[]> => {
    console.log(`Checking for uploaded files; Attempt: ${attempt}.`);

    const queryResult: any = await postGraphQLGetJson(
        "/graphql",
        getContentQuery(account)
    );
    const accountFiles = mapQueryResultToAccountFiles(queryResult);

    const MAX_ATTEMPTS = 5;
    const tooManyAttempts = attempt > MAX_ATTEMPTS;

    const foundFiles = files.filter((fileName) =>
        accountFiles.find((accFile) => accFile.path === path + fileName)
    );
    if (foundFiles.length === files.length || tooManyAttempts) {
        return foundFiles;
    }

    await wait(500);
    return pollForUploadedFiles(account, path, files, attempt + 1);
};

export const pollForRemovedFiles = async (
    account: string,
    files: string[],
    attempt = 1
): Promise<void> => {
    console.log(`Checking for removed files; Attempt: ${attempt}.`);

    const queryResult: any = await postGraphQLGetJson(
        "/graphql",
        getContentQuery(account)
    );
    const accountFiles = mapQueryResultToAccountFiles(queryResult);

    const MAX_ATTEMPTS = 5;
    const tooManyAttempts = attempt > MAX_ATTEMPTS;

    const foundAnyRemovedFile = files.some((fileName) =>
        accountFiles.find((accFile) => accFile.path === fileName)
    );
    if (!foundAnyRemovedFile) {
        return;
    }

    if (tooManyAttempts) {
        throw new Error("Too many attempts when trying to read removed files.");
    }

    await wait(500);
    return pollForRemovedFiles(account, files, attempt + 1);
};
