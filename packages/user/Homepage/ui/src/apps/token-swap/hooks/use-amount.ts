import { useState } from "react";

import { useUserTokenBalances } from "@/apps/tokens/hooks/tokensPlugin/use-user-token-balances";

import { Quantity } from "@shared/lib/quantity";

import { useToken } from "./use-token";
import { useParsedAmount } from "./use-parsed-amount";



export const useAmount = () => {
    const [tokenId, setTokenId] = useState<number>();
    const [amount, setAmountString] = useState<string>("");

    const { data: userBalances } = useUserTokenBalances();

    const balance =
        tokenId === undefined
            ? undefined
            : userBalances?.find((balance) => balance.id == tokenId)?.balance;

    const amountNumber = useParsedAmount(amount);

    const { data: tokenConfig } = useToken(tokenId);
    const precision = tokenConfig?.precision || 4;

    const amountQuantity =
        tokenId !== undefined && new Quantity(amount, precision || 4, tokenId);

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
        const [integer, decimal] = amount.split(".");
        if (decimal && decimal.length > 0) {
            setAmountString(integer + "." + decimal.slice(0, precision));
        } else {
            setAmountString(amount);
        }
    };

    return {
        obj,
        amount,
        tokenId,
        setAmount,
        setTokenId,
        balance,
        amountNumber,
        isOverBalance:
            amountQuantity && balance
                ? amountQuantity.isGreaterThan(balance)
                : false,
    };
};
