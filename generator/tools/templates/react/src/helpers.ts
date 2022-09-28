import { AppletId, query } from "common/rpc.mjs";

const accountSys = new AppletId("account-sys");

export const getLoggedInUser = () => query<void, string>(accountSys, "getLoggedInUser");

