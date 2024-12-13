import { useSearchParams } from "react-router-dom";
import { siblingUrl } from "@psibase/common-lib";
import { useUnmanagedKeyPair } from "./hooks/useUnmanagedKeypair";
import { base64ToPem, pemToBase64 } from "./lib/key";

//
// keyvault
// generate-keypair

// pub-from-priv
// priv-from-pub

function KeyImport() {
  const [searchParams] = useSearchParams();

  const key = searchParams.get("key");

  console.log(key, "is the key", siblingUrl());

  // 1. build a demo keypair, does not need to be managed...

  const { data } = useUnmanagedKeyPair();

  const encodedKey = data ? pemToBase64(data?.privateKey) : "";

  const rebuiltKey = base64ToPem(encodedKey);

  return (
    <div>
      <div className="mt-4">1. Random private key {data?.privateKey}</div>
      <div className="mt-4">
        2. Encoded
        {data && <div>{pemToBase64(data?.privateKey)}</div>}
      </div>
      <div className="mt-4">{rebuiltKey}</div>
      <div>
        {rebuiltKey == data?.privateKey ? "Matches!" : "does not match"}
      </div>
    </div>
  );
}

export default KeyImport;
