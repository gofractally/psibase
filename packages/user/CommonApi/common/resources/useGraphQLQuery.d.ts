declare module "common/useGraphQLQuery.mjs" {
    type QueryResult = {
        isLoading: boolean;
        isError: boolean;
        data?: any;
        errors?: any[];
    };

    interface PageInfo {
        hasPreviousPage: boolean;
        hasNextPage: boolean;
        startCursor: string;
        endCursor: string;
    }

    interface PagedQueryOptions {
        pageSize: number;
        getPageInfo(result: QueryResult): any;
        defaultArgs?: string;
    }

    function useGraphQLQuery(
        url?: string,
        query?: string
    ): [queryResult: QueryResult, invalidateQuery: () => void];

    function useGraphQLPagedQuery(
        url?: string,
        query?: string,
        opts?: PagedQueryOptions
    ): {
        result: QueryResult;
        hasPreviousPage: boolean;
        hasNextPage: boolean;
        next(): void;
        previous(): void;
        first(): void;
        last(): void;
    };
}
