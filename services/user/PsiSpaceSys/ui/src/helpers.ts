import { getJson, postGraphQLGetJson } from "common/rpc.mjs";
import { useEffect, useState } from "react";

export const getThisApplet = async (): Promise<string> =>
    (await getJson("/common/thiscontract")) as string;

// Returns: {
//     isLoading,   // Is the query in progress?
//     isError,     // Has an error happened?
//     data?,       // GraphQL query result
//     errors?,     // GraphQL errors, if any
// }
export function useGraphQLQuery(url: string, query: string) {
    const [refetch, setRefetch] = useState(true);
    const [cachedQueryResult, setCachedQueryResult] = useState<any>({
        isLoading: true,
        isError: false,
    });
    const invalidateQuery = () => {
        setRefetch(true);
    };
    const queryAndPackageResponse = async (url: string, query: string) => {
        setCachedQueryResult((prevState: any) => ({
            ...prevState,
            isLoading: true,
        }));
        let queryResult: any = await postGraphQLGetJson(url, query);
        setCachedQueryResult({
            ...queryResult,
            isLoading: false,
            isError: Boolean(queryResult.errors),
        });
    };
    useEffect(() => {
        (async () => {
            if (url && query && refetch) {
                try {
                    await queryAndPackageResponse(url, query);
                } catch (e) {
                    setCachedQueryResult({
                        isLoading: false,
                        isError: true,
                        errors: [{ message: e + "" }],
                    });
                }
                setRefetch(false);
            }
        })();
    }, [url, query, refetch]);
    return [cachedQueryResult, invalidateQuery];
} // useGraphQLQuery

export const capitalizeFirstLetter = (txt: string) => {
    return txt.charAt(0).toUpperCase() + txt.slice(1);
};
