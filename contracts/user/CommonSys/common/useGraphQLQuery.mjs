import { postGraphQLGetJson } from './rpc.mjs';

// Returns: {
//     isLoading,   // Is the query in progress?
//     isError,     // Has an error happened?
//     data?,       // GraphQL query result
//     errors?,     // GraphQL errors, if any
// }
export function useGraphQLQuery(url, query, opts) {
    // non-signalling state
    // const [state, setState] = React.useState({
    //     url: null,
    //     query: null,
    //     refreshRequested: false,
    // });
    const [refetch, setRefetch] = React.useState(false);
    const [cachedQueryResult, setCachedQueryResult] = React.useState({
        isLoading: true,
        isError: false,
    });
    const invalidateQuery = () => {
        console.info('invalidating query...')
        setRefetch(true);
    }
    const queryAndPackageResponse = async (url, query) => {
        console.info('queryAndPackageResponse.fetching...');
        let queryResult = await postGraphQLGetJson(url, query);
        setRefetch(false);
        console.info('useGraphQLQuery.queryResult:');
        console.info(queryResult);
        setCachedQueryResult({
            ...queryResult,
            isLoading: false,
            isError: Boolean(queryResult.errors),
        });
    };
    // if (state.url !== url || state.query !== query || state.refreshRequested !== refreshRequested) {
    //     setState({
    //         url,
    //         query,
    //         refreshRequested,
    //     });
    // }
    React.useEffect(() => {
        (async () => {
            console.info('considering a query url&&query[', !!(url&&query), '], refetch[', refetch, ']')
            if (url && query || refetch) {
                try {
                    await queryAndPackageResponse(url, query);
                } catch (e) {
                    setCachedQueryResult({
                        isLoading: false,
                        isError: true,
                        errors: [{ message: e + "" }],
                    });
                }
                console.info("========= END ============\n")
            }
            // setState((prevState) => ({
            //     ...prevState,
            //     refreshRequested: false,
            // }));
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
    opts, // {
    // pageSize,
    // getPageInfo, // useGraphQLQuery's result => PageInfo or null
    // defaultArgs,
    // }
) {
    const [args, setArgs] = React.useState(opts.defaultArgs || `first:${opts.pageSize}`);

    const [result, invalidateQuery] = useGraphQLQuery(url, query.replace("@page@", args), opts);

    // console.info("useGraphQLPagedQuery().result:");
    // console.info(result);
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
        },
        previous() {
            setArgs(`last:${opts.pageSize} before:"${pageInfo.startCursor}"`);
        },
        first() {
            setArgs(`first:${opts.pageSize}`);
        },
        last() {
            setArgs(`last:${opts.pageSize}`);
            invalidateQuery();
        },
    };
}
