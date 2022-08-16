import { postGraphQLGetJson } from './rpc.mjs';

// Returns: {
//     isLoading,   // Is the query in progress?
//     isError,     // Has an error happened?
//     data?,       // GraphQL query result
//     errors?,     // GraphQL errors, if any
// }
export function useGraphQLQuery(url, query) {
    console.info('useGraphQLQuery()')
    console.info('url:', url)
    console.info('query:', query)
    // non-signalling state
    const [state, setState] = React.useState({
        url: null,
        query: null,
        // refreshRequested: true,
    });
    const [cachedQueryResult, setCachedQueryResult] = React.useState({
        isLoading: true,
        isError: false,
        // refresh: () => {
        //     setState((prevState) => ({
        //         ...prevState,
        //         refreshRequested: true,
        //     }))
        // },
    });
    const queryAndPackageResponse = async (url, query) => {
        console.info('queryAndPackageResponse.fetching...');
        let queryResult = await postGraphQLGetJson(url, query);
        console.info('useGraphQLQuery.queryResult:');
        console.info(queryResult);
        setCachedQueryResult({
            ...queryResult,
            isLoading: false,
            isError: Boolean(queryResult.errors),
            // refresh: () => { setState.refreshRequested = true; },
        });
        // state.refreshRequested = false;
    };
    if (state.url !== url || state.query !== query) { // || state.refreshRequested) {
        console.info('updating state...')
        console.info('state:', state)
        console.info('new state:', {
            url, query,
        })
        setState((prevState) => ({
            url,
            query,
        }));
    }
    React.useEffect(() => {
        console.info('useGraphQLQuery().useEffect() to fetch');
        (async () => {
            if (url && query) {
                try {
                    await queryAndPackageResponse(url, query);
                } catch (e) {
                    setCachedQueryResult({
                        isLoading: false,
                        isError: true,
                        // refresh: () => { console.error("refresh() called in catch..."); },
                        errors: [{ message: e + "" }],
                    });
                }
            }
        })();
    }, [url, query]);
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
    const [args, setArgs] = React.useState(`first:${pageSize}`);
    const result = useGraphQLQuery(url, query.replace("@page@", args));
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
            setArgs(`first:${pageSize} after:"${pageInfo.endCursor}"`);
        },
        previous() {
            setArgs(`last:${pageSize} before:"${pageInfo.startCursor}"`);
        },
        first() {
            setArgs(`first:${pageSize}`);
        },
        last() {
            setArgs(`last:${pageSize}`);
        },
    };
}
