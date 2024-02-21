import { AppletId, query } from "@psibase/common-lib";

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

export const putJson = (url: string, json: any) => {
    return fetch(url, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(json),
    });
};

export const websocketURL = (path: string) => {
    const wsPath = import.meta.env.MODE === "development" ? `/ws${path}` : path;
    let result = new URL(wsPath, document.URL);
    if (result.protocol == "http:") {
        result.protocol = "ws:";
    } else if (result.protocol == "https:") {
        result.protocol = "wss:";
    }
    return result;
};
