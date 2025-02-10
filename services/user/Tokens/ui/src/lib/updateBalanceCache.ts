import { queryClient } from "@/main";
import QueryKey from "./queryKeys";
import { BalanceRes } from "@/hooks/tokensPlugin/useBalances";
import { updateArray } from "./updateArray";
import { z } from "zod";

const Operation = z.enum(["Add", "Subtract"]);

export const updateBalanceCache = (
  username: string,
  tokenId: string,
  amount: string,
  operation: z.infer<typeof Operation>
) => {
  queryClient.setQueryData(
    QueryKey.ui(username || "undefined"),
    (balances: BalanceRes | undefined) => {
      if (
        operation !== Operation.Enum.Add &&
        operation !== Operation.Enum.Subtract
      ) {
        throw new Error(`Unsupported operation`);
      }
      if (balances) {
        return {
          ...balances,
          tokens: updateArray(
            balances.tokens,
            (token) => token.id.toString() === tokenId && !!token.balance,
            (token) => ({
              ...token,
              balance:
                operation == "Add"
                  ? token.balance!.add(amount)
                  : token.balance!.subtract(amount),
            })
          ),
        };
      }
    }
  );
};
