import { useQuery } from "@tanstack/react-query";
import {
    privateStringToKeyPair,
} from "common/keyConversions.mjs";

export const parsePrivateKey = (
    privateKey: string | null
): { isValid: boolean; publicKey: string } => {
    if (privateKey === null) return { isValid: false, publicKey: "" };
    try {
        const res = privateStringToKeyPair(privateKey);

        return {
            isValid: true,
            publicKey: res.pub,
        };
    } catch (e) {
        return {
            isValid: false,
            publicKey: "",
        };
    }
};

export const useInviteToken = (privateKey: string | null) => {
    const publicKey = parsePrivateKey(privateKey);
    if (privateKey && !publicKey)
        throw new Error("private key passed is not valid");
    const { data, error } = useQuery(
        ["redemption", privateKey],
        async () => true,
        {
            enabled: publicKey.isValid,
        }
    );

    const isValid = data && publicKey;
    return { error, isValid };
};
