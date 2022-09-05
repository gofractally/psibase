import { postGraphQLGetJson } from "common/rpc.mjs";
import { useEffect, useMemo, useState } from "react";
import wait from "waait";
import { useGraphQLQuery } from "./helpers";

export const getContentQuery = (account = "") => {
    if (account) {
        return `
        {
          content(
            ge: {account: "${account}", path: ""}, 
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
): Promise<void> => {
    console.log(`Checking for uploaded files; Attempt: ${attempt}.`);

    checkMaxAttempts(attempt);

    const queryResult: any = await postGraphQLGetJson(
        "/graphql",
        getContentQuery(account)
    );
    const accountFiles = mapQueryResultToAccountFiles(queryResult);

    if (
        files.every((fileName) =>
            accountFiles.find((accFile) => accFile.path === path + fileName)
        )
    ) {
        return;
    }

    await wait(500);
    return pollForUploadedFiles(account, path, files, attempt + 1);
};

const MAX_ATTEMPTS = 5;
const checkMaxAttempts = (attempt: number) => {
    const tooManyAttempts = attempt > MAX_ATTEMPTS;

    if (tooManyAttempts) {
        throw new Error(
            `Exceeded polling deadline after ${MAX_ATTEMPTS} attempts.`
        );
    }
};
