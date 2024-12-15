import { useSearchParams } from "react-router-dom";
import { siblingUrl } from "@psibase/common-lib";
import { useUnmanagedKeyPair } from "./hooks/useUnmanagedKeypair";
import { base64ToPem, pemToBase64 } from "./lib/key";
import { modifyUrlParams } from "./lib/modifyUrlParams";
import { usePrivateToPublicKey } from "./hooks/usePrivateToPublicKey";

//
// keyvault
// generate-keypair

// pub-from-priv
// priv-from-pub

// create an account with a key...?
// then export the thing...?
// then allow import / lookup of the thing

function KeyImport() {
  const [searchParams] = useSearchParams();

  const key = searchParams.get("key");

  console.log(key, "is the key", siblingUrl());

  // 1. build a demo keypair, does not need to be managed...

  const { data } = useUnmanagedKeyPair();

  const encodedKey = data ? pemToBase64(data?.privateKey) : "";

  const url = modifyUrlParams(siblingUrl(null, "accounts"), {
    key: encodedKey,
  });

  const extractedPrivateKey = key && base64ToPem(key);

  const { data: publicKey } = usePrivateToPublicKey(extractedPrivateKey || "");

  // with the public key, work out what accounts are available for import
  // import them

  return (
    <div>
      <div className="mt-4">1. Key to import {url}</div>
      <div className="mt-4">
        2. Encoded
        {data && <div>{pemToBase64(data?.privateKey)}</div>}
      </div>
      <div className="mt-4">
        2. Extracted from the URL {extractedPrivateKey}{" "}
      </div>
      <div className="mt-4">3. {publicKey}</div>
    </div>
  );
}

export default KeyImport;
