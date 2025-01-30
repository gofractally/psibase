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
                console.error("Failed to fetch key devices", e);
                throw "Failed to fetch key devices";
            }
        },
    });

export const useAddServerKey = () =>
    useMutation<CryptoKeyPair, string>({
        mutationKey: queryKeys.addServerKey,
        mutationFn: async () => {
            const keyPair = await generateP256Key();
            const privateDER = await exportKeyToDER(
                keyPair.privateKey,
                "PRIVATE KEY"
            );

            chain.addServerKey({
                key: privateDER,
                device: undefined,
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
            console.log("Error unlocking key device:", err);
        },
    });
