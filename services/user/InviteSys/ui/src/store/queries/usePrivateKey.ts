import { useQuery } from "@tanstack/react-query";
import {
  privateStringToKeyPair,
  publicKeyPairToString,
} from "common/keyConversions.mjs";

export const parsePrivateKey = (
  privateKey: string | null
): { isValid: boolean; publicKey: string } => {
  if (privateKey === null) return { isValid: false, publicKey: "" };
  try {
    const tokenKeyPair = privateStringToKeyPair(privateKey);
    const publicKey = publicKeyPairToString(tokenKeyPair);

    return {
      isValid: true,
      publicKey,
    };
  } catch (e) {
    return {
      isValid: false,
      publicKey: "",
    };
  }
};

const wait = (ms: number = 1000) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const useInviteToken = (privateKey: string | null) => {
  const publicKey = parsePrivateKey(privateKey);
  if (privateKey && !publicKey)
    throw new Error("private key passed is not valid");
  const { data, error, isLoading } = useQuery(
    ["redemption", privateKey],
    async () => {
      await wait(1000);
      return true;
    },
    {
      enabled: publicKey.isValid,
    }
  );

  const isValid = data && publicKey;
  return { error, isValid, publicKey: publicKey.publicKey, isLoading };
};
