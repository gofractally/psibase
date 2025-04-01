import { useCurrentUser } from "./use-current-user";
import { useGroup } from "./use-group";
import { useSetGroupKey } from "./use-set-group-key";
import { getAsymmetricKey } from "@lib/keys";
import { decrypt, encrypt, PrivateKey } from "eciesjs";
import { sha256 } from "@noble/hashes/sha256";
import { Buffer } from "buffer";
import { useEffect } from "react";
import { z } from "zod";

globalThis.Buffer = Buffer; // polyfill manually

const getPseudoRandomValues = (length: number) => {
    const array = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        array[i] = Math.floor(Math.random() * 256); // 0-255
    }
    return array;
};

const base = z.object({
    loading: z.boolean(),
});

const zError = base.extend({
    message: z.string(),
    loading: z.literal(false),
    success: z.literal(false),
});

const zSuccess = base.extend({
    symmetricKey: z.instanceof(Buffer),
    loading: z.literal(false),
    success: z.literal(true),
});

const zLoading = base.extend({
    message: z.string(),
    loading: z.literal(true),
    success: z.literal(false),
});

const zResult = z.union([zError, zSuccess, zLoading]);

export const useSymKey = (
    evaluationId: number,
    groupNumber: number,
): z.infer<typeof zResult> => {
    const { data: currentUser } = useCurrentUser();
    const { data: groupData } = useGroup(evaluationId, groupNumber);

    const {
        mutate: setGroupKey,
        isPending: isSettingGroupKey,
        isError,
        error,
    } = useSetGroupKey();

    const secretFromStorage = getAsymmetricKey(evaluationId);

    if (!secretFromStorage) {
        return {
            success: false,
            message: "No secret found in storage",
            loading: false,
        };
    }
    const recreatedBuffer = Buffer.from(secretFromStorage, "base64");
    const privateKey = new PrivateKey(recreatedBuffer);

    useEffect(() => {
        const setKey = async () => {
            const symmetricKey = getPseudoRandomValues(32);
            const encryptedPayloads = groupData!.users
                .sort((a, b) => a.user.localeCompare(b.user))
                .map((user) => encrypt(user.key, symmetricKey));

            const hashArr = await sha256.create().update(symmetricKey).digest();
            const hashBase64 = Buffer.from(hashArr).toString("base64");

            setGroupKey({
                evaluationId,
                groupNumber,
                hash: hashBase64,
                keys: encryptedPayloads,
            });
        };

        if (
            currentUser &&
            groupData &&
            groupData.group.keySubmitter === null &&
            !isSettingGroupKey &&
            !isError
        ) {
            setKey();
        }
    }, [
        groupData,
        setGroupKey,
        isSettingGroupKey,
        isError,
        error,
        currentUser,
    ]);

    if (isSettingGroupKey) {
        return { loading: true, success: false, message: "Setting group key" };
    }

    if (!groupData || !currentUser) {
        return { loading: true, success: false, message: "Loading group data" };
    }

    const { group, users } = groupData;
    const myIndex = users
        .map((user) => user.user)
        .sort()
        .indexOf(currentUser);

    if (myIndex === -1) {
        return {
            success: false,
            loading: true,
            message: "Failing to find my index",
        };
    }

    const keyForMe = group.keys[myIndex];
    if (!keyForMe) {
        return {
            success: false,
            message: `Failed to find a key for user ${currentUser}`,
            loading: false,
        };
    }

    const myAssignedCipher = Buffer.from(keyForMe);
    const decryptedPayload = decrypt(privateKey.secret, myAssignedCipher);

    const hashArr = sha256.create().update(decryptedPayload).digest();
    const hashBase64 = Buffer.from(hashArr).toString("base64");

    if (hashBase64 !== group.keyHash) {
        return { success: false, message: "Invalid key hash", loading: false };
    }
    return { success: true, symmetricKey: decryptedPayload, loading: false };
};
