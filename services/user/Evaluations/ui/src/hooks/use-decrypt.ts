// import { z } from "zod";
// import { useGroup } from "./use-group";
// import { decrypt, encrypt, PrivateKey } from "eciesjs";
// import { Buffer } from "buffer";
// import { getAsymmetricKey } from "@lib/keys";
// import { useSetGroupKey } from "./use-set-group-key";

// import { sha256 } from "@noble/hashes/sha256";

// import { useCurrentUser } from "./use-current-user";

// globalThis.Buffer = Buffer; // polyfill manually

// const KeyStatus = z.enum(["Valid", "Mismatch", "Missing"]);

// const zResponse = z.object({
//     evaluationId: z.number(),
//     secret: z.string().optional(),
//     keyStatus: KeyStatus,
// });

// type Response = z.infer<typeof zResponse>;

// export const useDecrypt = (
//     evaluationId: number | undefined,
//     groupNumber: number | undefined,
// ): Response | undefined => {
//     if (!evaluationId) return undefined;
//     const { data: groupData, isLoading } = useGroup(evaluationId, groupNumber);
//     const {
//         mutate: setGroupKey,
//         isPending: isSettingGroupKey,
//         error: setGroupKeyError,
//     } = useSetGroupKey();
//     const { data: currentUser } = useCurrentUser();
//     if (isLoading || isSettingGroupKey) return undefined;
//     if (setGroupKeyError) {
//         console.error(setGroupKeyError);
//         return;
//     }
//     if (!groupData) throw new Error("Expected group data");
//     if (!currentUser) return;

//     const users = groupData.users;
//     const group = groupData.group;

//     const secretFromStorage = getAsymmetricKey(evaluationId);
//     if (secretFromStorage) {
//         console.log("secretFromStorage", secretFromStorage);
//         const recreatedBuffer = Buffer.from(secretFromStorage, "base64");
//         const privateKey = new PrivateKey(recreatedBuffer);
//         const publicKey = privateKey.publicKey.toHex();
//         // check if public key here matches the one in users table, otherwise its an invalid key

//         const matchesChain = users.find((user) => user.key === publicKey);
//         if (!matchesChain) {
//             return {
//                 evaluationId,
//                 keyStatus: KeyStatus.Values.Mismatch,
//             };
//         }

//         const symKeyRequired = group.keySubmitter === null;
//         // check for the sym key
//         if (symKeyRequired) {
//             // set the sym key
//             const symmetricKey = globalThis.crypto.getRandomValues(
//                 new Uint8Array(32),
//             );

//             console.log(symmetricKey, "is the hash of the symmkey");

//             const encryptedPayloads = users.map((user) =>
//                 encrypt(user.key, symmetricKey),
//             );

//             console.log(encryptedPayloads, "are the encrypted payloads!");

//             const hash = await sha256.create().update("derp").digest();

//             setGroupKey({
//                 evaluationId,
//                 groupNumber: groupNumber!,
//                 keys: encryptedPayloads,
//             });
//         } else {
//             const myIndex = users
//                 .map((user) => user.user)
//                 .sort()
//                 .indexOf(currentUser);
//             const keyForMe = group.keys[myIndex];
//             if (!keyForMe) throw new Error("No key for me");
//             const keyForMeBuffer = Buffer.from(keyForMe);
//             const symmetricKey = decrypt(privateKey.secret, keyForMeBuffer);
//             console.log(symmetricKey, "is the symmetric key?!");
//             // download the sym key and decrypt
//         }
//     } else {
//         console.log("no secret from storage");
//         return {
//             evaluationId,
//             keyStatus: KeyStatus.Values.Missing,
//         };
//     }
// };
