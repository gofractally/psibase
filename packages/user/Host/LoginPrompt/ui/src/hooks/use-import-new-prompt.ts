import { queryOptions, useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@shared/lib/supervisor";

import { callLoginPrompt } from "../lib/login-prompt";
import QueryKey from "../lib/query-keys";

const zImportContext = z.object({
    account: z.string(),
    key: z.string(),
    login: z.boolean(),
});

export const queryImportNewPrompt = queryOptions({
    queryKey: QueryKey.importNewPrompt(),
    queryFn: async () => {
        const [context, app] = await Promise.all([
            callLoginPrompt("api", "getImportContext", []),
            supervisor.functionCall({
                service: "host",
                plugin: "client",
                intf: "api",
                method: "getActiveApp",
                params: [],
            }),
        ]);
        return {
            ...zImportContext.parse(context),
            app: z.string().parse(app),
        };
    },
});

export const useImportNewPrompt = () => useQuery(queryImportNewPrompt);
