import { query } from "common/rpc.mjs";

export const fetchQuery = <T>(
    queryName: string,
    contract: string,
    params: any = {},
    subPath: string = ""
): Promise<T> => {
    return query(contract, subPath, queryName, params);
};

export const getLoggedInUser = () =>
    fetchQuery<string>("getLoggedInUser", "account-sys");
