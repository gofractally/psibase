import { postGraphQLGetJson } from '/common/rpc.mjs?client';

// Returns: {
//     isLoading,   // Is the query in progress?
//     isError,     // Has an error happened?
//     data?,       // GraphQL query result
//     errors?,     // GraphQL errors, if any
// }
export async function useGraphQLQuery(url, query) {
    const queryResult = await postGraphQLGetJson(url, query);
    return {
        ...queryResult,
        isLoading: false,
        isError: Boolean(queryResult.errors),
    };
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
export async function useGraphQLPagedQuery(
    url,
    query,
    opts,
    // opts = {
    // pageSize,
    // getPageInfo, // useGraphQLQuery's result => PageInfo or null
    // defaultArgs,
    // }
) {
    // const [args, setArgs] = React.useState(opts.defaultArgs || `first:${opts.pageSize}`);
    const args = opts.defaultArgs || `first:${opts.pageSize}`;

    const result = await useGraphQLQuery(url, query.replace("@page@", args));

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
        next(setArgs) {
            setArgs(`first=${opts.pageSize}&after="${pageInfo.endCursor}"`);
        },
        previous(setArgs) {
            setArgs(`last=${opts.pageSize}&before="${pageInfo.startCursor}"`);
        },
        first(setArgs) {
            setArgs(`first=${opts.pageSize}`);
        },
        last(setArgs) {
            setArgs(`last=${opts.pageSize}`);
        },
    };
}
