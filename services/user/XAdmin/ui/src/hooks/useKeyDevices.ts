import { useMutation, useQuery } from "@tanstack/react-query";

import { chain } from "@/lib/chainEndpoints";
import { hexDERPublicKeyToCryptoKey } from "@/lib/keys";
import { queryKeys } from "@/lib/queryKeys";

export const useKeyDevices = () =>
    useQuery({
        queryKey: queryKeys.keyDevices,
        queryFn: async () => {
            try {
                return await chain.getKeyDevices();
            } catch (e) {
                console.error("Failed to fetch security devices", e);
                throw new Error("Failed to fetch security devices");
            }
        },
    });

export const useServerKeys = () =>
    useQuery({
        queryKey: queryKeys.serverKeys,
        queryFn: async () => {
            try {
                return await chain.getServerKeys();
            } catch (e) {
                console.error("Failed to fetch server keys", e);
                throw new Error("Failed to fetch server keys");
            }
        },
    });

export const useAddServerKey = () =>
    useMutation<CryptoKey, string, string>({
        mutationKey: queryKeys.addServerKey,
        mutationFn: async (device?: string) => {
            const result = await chain.addServerKey({
                device,
            });

            const service = result[0].service;
            if (service !== "verify-sig") {
                throw new Error(`Unexpected service: ${service}"`);
            }

            const der = result[0].rawData;
            const publicKey = await hexDERPublicKeyToCryptoKey(der);
            return publicKey;
        },
        onError: (err) => {
            console.log("Error adding server key:", err);
        },
    });

export const useUnlockKeyDevice = () =>
    useMutation({
        mutationKey: queryKeys.unlockKeyDevice,
        mutationFn: async ({
            device,
            pin,
        }: {
            device: string;
            pin?: string;
        }) => {
            await chain.unlockKeyDevice(device, pin);
        },
        onError: (err) => {
            console.log("Error unlocking security device:", err);
        },
    });
