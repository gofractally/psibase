import { AppletId, getJson, query } from "common/rpc.mjs";


export const fetchQuery = async <T>(
    queryName: string,
    params: any = {},
    subPath: string = ""
): Promise<T> => {

    const thisApplet = await getJson<string>("/common/thisservice");
    const applet = new AppletId(thisApplet, subPath);

    return query(applet, queryName, params);
};

export const getLoggedInUser = () =>
    fetchQuery<string>("getLoggedInUser");


