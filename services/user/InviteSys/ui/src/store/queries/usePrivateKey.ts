import { useQuery } from "@tanstack/react-query";
import {
  privateStringToKeyPair,
  publicKeyPairToString,
  postGraphQLGetJson,
} from "@psibase/common-lib";

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
    getInvite(pubkey: "${publicKey}") {
      pubkey
      inviter
      actor
      expiry
      newAccountToken
      state
    }
}`;


export enum InviteStates {
   pending,
   accepted,
   rejected
};


const unixTime = () => Math.floor(Date.now() / 1000)

export const fetchInvite = async (publicKey: string) => {
  const query = queryInviteKey(publicKey);
  return postGraphQLGetJson<{ data: { getInvite: { actor: string, expiry: number, inviter: string, newAccountToken: boolean, pubkey: string, state: InviteStates }}}>("/graphql", query)
};

export const useInviteToken = (privateKey: string | null) => {
  const publicKey = parsePrivateKey(privateKey);
  if (privateKey && !publicKey)
    throw new Error("private key passed is not valid");
  const { data, error, isLoading } = useQuery(
    ["inviteToken", publicKey.publicKey],
    async () => {
      const res = await fetchInvite(publicKey.publicKey);
      return res.data.getInvite;
    },
    {
      enabled: publicKey.isValid,
    }
  );

  const currentTime = unixTime();
  const isExpired = data ? currentTime > data.expiry: false

  const isValid = !!(data && publicKey && !isExpired)
  return { 
    error: isExpired ? "Token expired": error, 
    isValid, 
    publicKey: publicKey.publicKey, 
    data, 
    isLoading 
  };
};

