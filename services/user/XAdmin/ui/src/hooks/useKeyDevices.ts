import { useQuery, useMutation } from "@tanstack/react-query";

import { queryKeys } from "@/lib/queryKeys";
import { chain } from "@/lib/chainEndpoints";
import { exportKeyToDER, generateP256Key } from "@/lib/keys";

export const useKeyDevices = () =>
    useQuery({
        queryKey: queryKeys.keyDevices,
        queryFn: async () => {
            try {
                return chain.getKeyDevices();
            } catch (e) {
                console.error("Failed to fetch security devices", e);
                throw "Failed to fetch security devices";
            }
        },
    });

export const useAddServerKey = () =>
    useMutation<CryptoKeyPair, string, string>({
        mutationKey: queryKeys.addServerKey,
        mutationFn: async (device?: string) => {
            const keyPair = await generateP256Key();
            const privateDER = await exportKeyToDER(
                keyPair.privateKey,
                "PRIVATE KEY"
            );

            chain.addServerKey({
                key: privateDER,
                device,
            });
            return keyPair;
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
