import { useState } from "react";


export const useAmount = () => {
    const [tokenId, setTokenId] = useState<number>();
    const [amount, setAmount] = useState<string>("");

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
    };
};