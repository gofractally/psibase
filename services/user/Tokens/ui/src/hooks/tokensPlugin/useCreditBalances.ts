import { Account } from "@/lib/types";
import { FunctionCallArgs } from "@psibase/common-lib";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { functionCall } from "@/lib/functionCall";

const CreditBalance = z.object({
  balance: z.string(),
  creditor: Account,
  debitor: Account,
  tokenId: z.number(),
});

const callArgsToQueryKey = (param: FunctionCallArgs) => [
  param.method,
  param.service,
  param.intf ? param.intf : "",
  param.plugin ? param.plugin : "",
];

const usePluginQuery = <T extends z.ZodTypeAny, Y>(
  query: FunctionCallArgs,
  schema: T,
  initialData?: Y
) => {
  const queryKey = callArgsToQueryKey(query);

  return useQuery<unknown, unknown, z.infer<T>>({
    queryKey,
    queryFn: async () => {
      const rawData = await functionCall(query);
      return schema.parse(rawData);
    },
    initialData,
  });
};

export const useCreditBalances = () =>
  usePluginQuery(
    {
      method: "balances",
      intf: "transfer",
      service: "tokens",
      params: [],
    },
    z.array(CreditBalance)
  );
