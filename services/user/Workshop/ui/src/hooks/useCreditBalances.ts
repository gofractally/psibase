// import { useSupervisor } from "./useSupervisor";
// import { FunctionCallArgs } from "@psibase/common-lib";
// import { useQuery } from "@tanstack/react-query";
// import { z } from "zod";

// const CreditBalance = z.object({
//   balance: z.string(),
//   creditor: z.string(),
//   debitor: z.string(),
//   tokenId: z.number(),
// });

// const callArgsToQueryKey = (param: FunctionCallArgs) => [
//   param.method,
//   param.service,
//   param.intf ? param.intf : "",
//   param.plugin ? param.plugin : "",
// ];

// const usePluginQuery = <T extends z.ZodTypeAny, Y>(
//   query: FunctionCallArgs,
//   schema: T,
//   initialData?: Y
// ) => {
//   const supervisor = useSupervisor();
//   const queryKey = callArgsToQueryKey(query);

//   return useQuery<unknown, unknown, z.infer<T>>({
//     queryKey,
//     queryFn: async () => {
//       await supervisor.onLoaded();
//       const rawData = await supervisor.functionCall(query);
//       return schema.parse(rawData);
//     },
//     initialData,
//   });
// };

// export const useCreditBalances = () =>
//   usePluginQuery(
//     {
//       method: "balances",
//       intf: "transfer",
//       service: "tokens",
//       params: [],
//     },
//     z.array(CreditBalance)
//   );
