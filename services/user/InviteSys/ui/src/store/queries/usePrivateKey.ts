import { useQuery } from "@tanstack/react-query";
import {
  privateStringToKeyPair,
  publicKeyPairToString,
} from "common/keyConversions.mjs";
import { postGraphQLGetJson } from "common/rpc.mjs";

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

const wait = (ms: number = 1000): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const queryInviteKey = (publicKey: string): string => `{
    getInvite(pubkey: "${publicKey}")
}`;
  
export const fetchInvite = (publicKey: string) => postGraphQLGetJson("/graphql", queryInviteKey(publicKey));

export const useInviteToken = (privateKey: string | null) => {
  const publicKey = parsePrivateKey(privateKey);
  if (privateKey && !publicKey)
    throw new Error("private key passed is not valid");
  const { data, error, isLoading } = useQuery(
    ["redemption", privateKey],
    async () => {
      console.log('xxx', publicKey.publicKey)
      const res = await fetchInvite(publicKey.publicKey);
      console.log(res, 'was the res!');
      return true;
    },
    {
      enabled: publicKey.isValid,
    }
  );

  const isValid = data && publicKey;
  return { error, isValid, publicKey: publicKey.publicKey, isLoading };
};
