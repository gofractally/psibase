import { AppletId, query } from "common/rpc.mjs";

export const fetchUser = async (): Promise<string> => {
    const accountSys = new AppletId("account-sys");
    const getLoggedInUser = () =>
        query<void, string>(accountSys, "getLoggedInUser");

    const user = (await getLoggedInUser()) as string;
    return user;
};
