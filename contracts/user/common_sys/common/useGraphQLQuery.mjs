import { postTextGetJson } from './rpc.mjs';

// Returns: {
//     isLoading,   // Is the query in progress?
//     isError,     // Has an error happened?
//     data?,       // GraphQL query result
//     errors?,     // GraphQL errors, if any
// }
export function useGraphQLQuery(url, query, extraDependency) {
    const [cachedQueryResult, setCachedQueryResult] = React.useState({
        isLoading: true,
        isError: false,
    });
    // non-signalling state
    const [state] = React.useState({
        mounted: true,
        url: null,
        query: null,
        fetchId: 0,
        extraDependency: null,
    });
    React.useEffect(() => {
        return () => {
            state.mounted = false;
        };
    }, []);
    React.useEffect(() => {
        (async () => {
            if (state.url !== url || state.query !== query || state.extraDependency !== extraDependency) {
                state.url = url;
                state.query = query;
                state.extraDependency = extraDependency;
                state.fetchId += 1;
                let fetchId = state.fetchId;
                if (url && query) {
                    try {
                        let queryResult = await postTextGetJson(url, query);
                        if (state.mounted && fetchId == state.fetchId) {
                            setCachedQueryResult({
                                ...queryResult,
                                isLoading: false,
                                isError: Boolean(queryResult.errors),
                            });
                        }
                    } catch (e) {
                        if (state.mounted && fetchId == state.fetchId) {
                            setCachedQueryResult({
                                isLoading: false,
                                isError: true,
                                errors: [{ message: e + "" }],
                            });
                        }
                    }
                }
            }
        })();
    });
    return cachedQueryResult;
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
    pageSize,
    getPageInfo, // useGraphQLQuery's result => PageInfo or null
) {
    const [extraDependency, setExtraDependency] = React.useState(0);
    const [args, setArgs] = React.useState(`first:${pageSize}`);
    const result = useGraphQLQuery(url, query.replace("@page@", args), extraDependency);
    const pageInfo = getPageInfo(result) || {
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
            setExtraDependency(extraDependency + 1);
            setArgs(`first:${pageSize} after:"${pageInfo.endCursor}"`);
        },
        previous() {
            setExtraDependency(extraDependency + 1);
            setArgs(`last:${pageSize} before:"${pageInfo.startCursor}"`);
        },
        first() {
            setExtraDependency(extraDependency + 1);
            setArgs(`first:${pageSize}`);
        },
        last() {
            setExtraDependency(extraDependency + 1);
            setArgs(`last:${pageSize}`);
        },
    };
}
