import { supervisor } from "@/main";
import { UseQueryOptions, useQuery } from "@tanstack/react-query";
import { ZodSchema } from "zod";

import { FunctionCallArgs } from "@psibase/common-lib";

export const useFunctionCall = <T>(
    params: FunctionCallArgs,
    options: Omit<UseQueryOptions, "queryKey" | "queryFn">,
    resultSchema: ZodSchema<T>,
) =>
    useQuery({
        queryKey: [params.service, params.method, params.params],
        queryFn: async () => {
            const res = await supervisor.functionCall(params);
            return resultSchema.parse(res);
        },
        ...options,
    });
