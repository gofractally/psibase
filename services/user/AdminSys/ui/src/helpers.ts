import { AppletId, query } from "common/rpc.mjs";

export const fetchQuery = <T>(
    queryName: string,
    contract: string,
    params: any = {},
    subPath: string = ""
): Promise<T> => {
    return query(new AppletId(contract, subPath), queryName, params);
};

export const getLoggedInUser = () =>
    fetchQuery<string>("getLoggedInUser", "account-sys");

export const wait = (ms: number) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};
