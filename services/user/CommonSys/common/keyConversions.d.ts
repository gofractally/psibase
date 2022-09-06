declare module "common/keyConversions.mjs" {
  const KeyType = {
    k1: 0,
    r1: 1,
  };

  const publicKeyDataSize: number;
  const privateKeyDataSize: number;
  const signatureDataSize: number;

  const base58Chars: string;

  function create_base58_map(): string;

  function base58ToBinary(size: number, s: string): Uint8Array;

  function binaryToBase58(bignum: Uint8Array): string;

  function digestSuffixRipemd160(data: string, suffix: string);

  function stringToKey(s: string, size: number, suffix: string): Uint8Array;

  function keyToString(data: any, suffix: string, prefix: string): string;

  let k1;
  function getK1(): any;

  let r1;
  function getR1(): any;

  // Convert a private key in string form to {keyType, keyPair}
  function privateStringToKeyPair(s: string): any;

  // Convert a public key in string form to {keyType, keyPair}
  function publicStringToKeyPair(s: string): any;

  // Convert the private key in {keyType, keyPair} to a string
  function privateKeyPairToString({ keyType, keyPair }: any): string;

  // Convert the public key in {keyType, keyPair} to a string
  function publicKeyPairToString({ keyType, keyPair }: any): string;

  // Convert the public key in {keyType, keyPair} to fracpack format
  function publicKeyPairToFracpack({ keyType, keyPair }: any): Uint8Array;

  // Convert the signature in {keyType, signature} to fracpack format
  function signatureToFracpack({ keyType, signature }: any): Uint8Array;

  function keyPairStrings(key: any): any;

  function genKeyPair(keyType: any): any;

  // console.log(privateKeyPairToString(privateStringToKeyPair('PVT_R1_fJ6ASApAc9utAL4zfNE4qwo22p7JpgHHSCVJ9pQfw4vZPXCq3')));
  // console.log(publicKeyPairToString(privateStringToKeyPair('PVT_R1_fJ6ASApAc9utAL4zfNE4qwo22p7JpgHHSCVJ9pQfw4vZPXCq3')));
  // console.log(publicKeyPairToString(publicStringToKeyPair('PUB_R1_7pGpnu7HZVwi8kiLLDK2MJ6aYYS23eRJYmDXSLq5WZFCN6WEqY')));

  // console.log(privateKeyPairToString(privateStringToKeyPair('PVT_K1_2bfGi9rYsXQSXXTvJbDAPhHLQUojjaNLomdm3cEJ1XTzMqUt3V')));
  // console.log(publicKeyPairToString(privateStringToKeyPair('PVT_K1_2bfGi9rYsXQSXXTvJbDAPhHLQUojjaNLomdm3cEJ1XTzMqUt3V')));
  // console.log(publicKeyPairToString(publicStringToKeyPair('PUB_K1_6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5BoDq63')));
}
