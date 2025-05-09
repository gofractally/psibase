import { queryClient } from "@/queryClient";
import { useLocalStorage } from "@uidotdev/usehooks";
import { useEffect } from "react";
import { z } from "zod";

import { Account } from "@/lib/zodTypes";

import { appMetadataQueryKey, fetchMetadata } from "./useAppMetadata";
import { useCurrentFractal } from "./useCurrentFractal";
import { wait } from "./wait";

type AccountType = z.infer<typeof Account>;

const AppItem = z.object({
    account: Account,
});

export const Apps = AppItem.array();

const cacheApps = async (accountNames: z.infer<typeof Account>[]) => {
    for (const account of accountNames) {
        await wait(1000);
        queryClient.prefetchQuery({
            queryKey: appMetadataQueryKey(account),
            queryFn: async () => {
                return fetchMetadata(account);
            },
        });
    }
};

export const useTrackedFractals = () => {
    const [fractals, setFractals] = useLocalStorage<z.infer<typeof Apps>>(
        "trackedFractals",
        [],
    );

    const currentFractal = useCurrentFractal();

    useEffect(() => {
        const firstFractal = fractals[0];
        const currentFractalIsntFirst =
            firstFractal?.account !== currentFractal;

        if (firstFractal && currentFractalIsntFirst && currentFractal) {
            AppItem.parse(firstFractal);
            const currentFractalStored = fractals.find(
                (fractal) => fractal.account === currentFractal,
            );
            if (currentFractalStored) {
                setFractals((preExistingFractals) => {
                    const newData = AppItem.array().parse([
                        currentFractalStored,
                        ...preExistingFractals.filter(
                            (fractal) => fractal.account !== currentFractal,
                        ),
                    ]);

                    return newData;
                });
            }
        }
    }, [currentFractal, fractals]);

    useEffect(() => {
        cacheApps(fractals.map((fractal) => fractal.account));
    }, []);

    const addFractal = (newFractal: AccountType): void => {
        const isAlreadyExisting = fractals.some(
            (fractal) => fractal.account == newFractal,
        );
        if (isAlreadyExisting) {
            console.warn(
                "Tried adding a fractal already tracked in local storage",
            );
            return;
        }
        setFractals((fractals) =>
            AppItem.array().parse([{ account: newFractal }, ...fractals]),
        );
    };

    const removeFractal = (fractalBeingRemoved: AccountType) => {
        const isExisting = fractals.some(
            (fractal) => fractal.account == fractalBeingRemoved,
        );

        if (isExisting) {
            setFractals((fractals) =>
                AppItem.array().parse(
                    fractals.filter(
                        (fractal) => fractal.account !== fractalBeingRemoved,
                    ),
                ),
            );
        } else {
            throw new Error(
                `Failed to remove fractal ${fractalBeingRemoved}, does not exist.`,
            );
        }
    };

    return {
        addFractal,
        removeFractal,
        fractals,
    };
};
