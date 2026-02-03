import { useUserTokenBalances } from "@/apps/tokens/hooks/tokensPlugin/use-user-token-balances";
import { useMemo, useState } from "react";

import { Quantity } from "@shared/lib/quantity";
import { useToken } from "./use-token";


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
    const [amount, setAmountString] = useState<string>("");

    const { data: userBalances } = useUserTokenBalances();
    
    const balance = tokenId === undefined ? undefined : userBalances?.find(balance => balance.id == tokenId)?.balance;
    
    const amountNumber = useParsedAmount(amount);

    const { data: tokenConfig } = useToken(tokenId)
    const precision = tokenConfig?.precision || 4;

    const amountQuantity = tokenId !== undefined && new Quantity(amount, precision || 4, tokenId);

    const obj = tokenId
        ? {
            tokenId,
            amount,
            symbol: tokenConfig?.symbol,
            precision: precision,
        }
        : undefined;

        const setAmount = (amount: string) => {
          // trim by precision
          const [integer, decimal] = amount.split('.');
          if (decimal && decimal.length > 0) {
            setAmountString(integer + '.' + decimal.slice(0, precision))
          } else {
            setAmountString(amount);
          }
        }


    return {
        obj,
        amount,
        tokenId,
        setAmount,
        setTokenId,
        balance,
        amountNumber,
        isOverBalance: amountQuantity && balance ? amountQuantity.isGreaterThan(balance) : false
    };
};