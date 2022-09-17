import { postGraphQLGetJson } from "./rpc.mjs";

// Returns: {
//     isLoading,   // Is the query in progress?
//     isError,     // Has an error happened?
//     data?,       // GraphQL query result
//     errors?,     // GraphQL errors, if any
// }
export function useGraphQLQuery(url, query) {
    const [refetch, setRefetch] = React.useState(true);
    const [cachedQueryResult, setCachedQueryResult] = React.useState({
        isLoading: true,
        isError: false,
    });
    const invalidateQuery = () => {
        setRefetch(true);
    };
    const queryAndPackageResponse = async (url, query) => {
        setCachedQueryResult((prevState) => ({
            ...prevState,
            isLoading: true,
        }));
        let queryResult = await postGraphQLGetJson(url, query);
        setCachedQueryResult({
            ...queryResult,
            isLoading: false,
            isError: Boolean(queryResult.errors),
        });
    };
    React.useEffect(() => {
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

/*
interface PageInfo {
    hasPreviousPage: boolean;
    hasNextPage: boolean;
    startCursor: string;
    endCursor: string;
}
*/

// Returns: {
//     result: useGraphQLQuery's result;
//     hasPreviousPage: boolean;
//     hasNextPage: boolean;
//     next(): void;
//     previous(): void;
//     first(): void;
//     last(): void;
// }
export function useGraphQLPagedQuery(
    url,
    query,
    opts // opts = {
    // pageSize,
    // getPageInfo, // useGraphQLQuery's result => PageInfo or null
    // defaultArgs,
    // }
) {
    const [args, setArgs] = React.useState(
        opts.defaultArgs || `first:${opts.pageSize}`
    );
    const [result, invalidateQuery] = useGraphQLQuery(
        url,
        query.replace("@page@", args)
    );

    const pageInfo = opts.getPageInfo(result) || {
        hasPreviousPage: false,
        hasNextPage: false,
        startCursor: "",
        endCursor: "",
    };
    return {
        result,
        hasPreviousPage: pageInfo.hasPreviousPage,
        hasNextPage: pageInfo.hasNextPage,
        next() {
            setArgs(`first:${opts.pageSize} after:"${pageInfo.endCursor}"`);
            invalidateQuery();
        },
        previous() {
            setArgs(`last:${opts.pageSize} before:"${pageInfo.startCursor}"`);
            invalidateQuery();
        },
        first() {
            setArgs(`first:${opts.pageSize}`);
            invalidateQuery();
        },
        last() {
            setArgs(`last:${opts.pageSize}`);
            invalidateQuery();
        },
    };
}
