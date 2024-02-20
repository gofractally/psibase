// Invite Token Helper functions
import {
  privateKeyPairToString,
  privateStringToKeyPair,
  publicKeyPairToString,
} from "@psibase/common-lib";

export const extractInviteTokenKeyPair = () => {
  const urlParams = new URLSearchParams(window.location.search);
  if (!urlParams.has("token")) {
    return;
  }

  const token: string = urlParams.get("token")!;
  const keyPair = privateStringToKeyPair(token);
  const privateKey = privateKeyPairToString(keyPair);
  const publicKey = publicKeyPairToString(keyPair);
  return { privateKey, publicKey };
};
