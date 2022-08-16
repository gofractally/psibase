import { postGraphQLGetJson } from './rpc.mjs';

// Returns: {
//     isLoading,   // Is the query in progress?
//     isError,     // Has an error happened?
//     data?,       // GraphQL query result
//     errors?,     // GraphQL errors, if any
// }
export function useGraphQLQuery(url, query, extraDependency) {
    // non-signalling state
    const [state] = React.useState({
        mounted: true,
        url: null,
        query: null,
        fetchId: 0,
        extraDependency: null,
        refreshRequested: true,
    });
    const [cachedQueryResult, setCachedQueryResult] = React.useState({
        isLoading: true,
        isError: false,
        refresh: () => { state.refreshRequested = true; },
    });
    const queryAndPackageResponse = async (url, query, fetchId) => {
        console.info('queryAndPackageResponse.fetching...');
        let queryResult = await postGraphQLGetJson(url, query);
        console.info('useGraphQLQuery.queryResult:');
        console.info(queryResult);
        if (state.mounted && fetchId == state.fetchId) {
            setCachedQueryResult({
                ...queryResult,
                isLoading: false,
                isError: Boolean(queryResult.errors),
                refresh: () => { state.refreshRequested = true; },
            });
            state.refreshRequested = false;
        }
    };
    React.useEffect(() => {
        return () => {
            state.mounted = false;
        };
    }, []);
    React.useEffect(() => {
        console.info('useGraphQLQuery().useEffect() to fetch');
        (async () => {
            if (state.url !== url || state.query !== query || state.extraDependency !== extraDependency ) { // || state.refreshRequested) {
                state.url = url;
                state.query = query;
                state.extraDependency = extraDependency;
                state.fetchId += 1;
                let fetchId = state.fetchId;
                if (url && query) {
                    try {
                        await queryAndPackageResponse(url, query, fetchId);
                    } catch (e) {
                        if (state.mounted && fetchId == state.fetchId) {
                            setCachedQueryResult({
                                isLoading: false,
                                isError: true,
                                refresh: () => { console.error("refresh() called in catch..."); },
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
    // console.info("useGraphQLPagedQuery().result:");
    // console.info(result);
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
