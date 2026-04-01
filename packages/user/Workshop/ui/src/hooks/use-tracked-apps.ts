import { useLocalStorage } from "@uidotdev/usehooks";
import { useEffect } from "react";
import { z } from "zod";

import { queryClient } from "@shared/lib/queryClient";
import { type Account, zAccount } from "@shared/lib/schemas/account";

import { wait } from "../lib/wait";
import { appMetadataQueryKey, fetchMetadata } from "./use-app-metadata";
import { useCurrentApp } from "./use-current-app";

const AppItem = z.object({
    account: zAccount,
});

export const Apps = AppItem.array();

const cacheApps = async (accountNames: z.infer<typeof zAccount>[]) => {
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

export const useTrackedApps = () => {
    const [apps, setApps] = useLocalStorage<z.infer<typeof Apps>>(
        "trackedApps",
        [],
    );

    const currentApp = useCurrentApp();

    useEffect(() => {
        const firstApp = apps[0];
        const currentAppIsntFirst = firstApp?.account !== currentApp;

        if (firstApp && currentAppIsntFirst && currentApp) {
            AppItem.parse(firstApp);
            const currentAppStored = apps.find(
                (app) => app.account === currentApp,
            );
            if (currentAppStored) {
                setApps((preExistingApps) => {
                    const newData = AppItem.array().parse([
                        currentAppStored,
                        ...preExistingApps.filter(
                            (app) => app.account !== currentApp,
                        ),
                    ]);

                    return newData;
                });
            }
        }
    }, [currentApp, apps]);

    useEffect(() => {
        cacheApps(apps.map((app) => app.account));
    }, []);

    const addApp = (newApp: Account): void => {
        const isAlreadyExisting = apps.some((app) => app.account == newApp);
        if (isAlreadyExisting) {
            console.warn(
                "Tried adding an app already tracked in local storage",
            );
            return;
        }
        setApps((apps) =>
            AppItem.array().parse([{ account: newApp }, ...apps]),
        );
    };

    const removeApp = (appBeingRemoved: Account) => {
        const isExisting = apps.some((app) => app.account == appBeingRemoved);

        if (isExisting) {
            setApps((apps) =>
                AppItem.array().parse(
                    apps.filter((app) => app.account !== appBeingRemoved),
                ),
            );
        } else {
            throw new Error(
                `Failed to remove app ${appBeingRemoved}, does not exist.`,
            );
        }
    };

    return {
        addApp,
        removeApp,
        apps,
    };
};
