import { useUserTokenBalances } from "@/apps/tokens/hooks/tokensPlugin/use-user-token-balances";
import { useMemo, useState } from "react";


const useParsedAmount = (rawAmount: string): number | undefined => {
  return useMemo(() => {
    if (!rawAmount || rawAmount.trim() === "") {
      return undefined;
    }

    const cleaned = rawAmount.trim();

    // Common incomplete inputs people type moment-by-moment
    if (
      cleaned === "." ||
      cleaned === "0." ||
      cleaned === "00." ||
      cleaned === "000." ||
      // you can extend this list if your users have particular habits
      cleaned === "-." ||
      cleaned === "-0."
    ) {
      return undefined;
    }

    // Incomplete decimal (most common typing state)
    if (cleaned.endsWith(".")) {
      return undefined;
    }

    const num = Number(cleaned);

    if (Number.isNaN(num)) {
      return undefined;
    }

    // Optional: forbid negatives in many crypto/deposit contexts
    if (num < 0) return undefined;


    return num;
  }, [rawAmount]);
};
export const useAmount = () => {
    const [tokenId, setTokenId] = useState<number>();
    const [amount, setAmount] = useState<string>("");

    const { data: userBalances } = useUserTokenBalances();
    
    const balance = tokenId === undefined ? undefined : userBalances?.find(balance => balance.id == tokenId)?.balance;
    const amountNumber = useParsedAmount(amount);

    const obj = tokenId
        ? {
            tokenId,
            amount,
        }
        : undefined;


    return {
        obj,
        amount,
        tokenId,
        setAmount,
        setTokenId,
        balance,
        amountNumber,
    };
};