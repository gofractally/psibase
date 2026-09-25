import { getSubDomain } from "@shared/lib/get-sub-domain";
import { type Account, zAccount } from "@shared/lib/schemas/account";

import { type PluginCall } from "./lib/call-plugin-function";

/** Service of the app hosting this UI. An app calls its own plugin. */
export const hostingAppService = (): Account => zAccount.parse(getSubDomain());

export const hostingAppCall = <
    TParams extends unknown[] = [],
    TReturn = unknown,
>(
    intf: string,
    method: string,
): PluginCall<TParams, TReturn> => ({
    intf,
    method,
    service: hostingAppService(),
});
