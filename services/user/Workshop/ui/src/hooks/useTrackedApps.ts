import { z } from "zod";
import { Account } from "@/lib/zodTypes";
import { useCurrentApp } from "./useCurrentApp";
import { useEffect } from "react";
import { useLocalStorage } from "@uidotdev/usehooks";
import { queryClient } from "@/queryClient";
import { appMetadataQueryKey, fetchMetadata } from "./useAppMetadata";
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

export const useTrackedApps = () => {
  const [apps, setApps] = useLocalStorage<z.infer<typeof Apps>>(
    "trackedApps",
    []
  );

  const currentApp = useCurrentApp();

  useEffect(() => {
    const firstApp = apps[0];
    const currentAppIsntFirst = firstApp?.account !== currentApp;

    if (firstApp && currentAppIsntFirst && currentApp) {
      AppItem.parse(firstApp);
      const currentAppStored = apps.find((app) => app.account === currentApp);
      if (currentAppStored) {
        setApps((preExistingApps) => {
          const newData = AppItem.array().parse([
            currentAppStored,
            ...preExistingApps.filter((app) => app.account !== currentApp),
          ]);

          return newData;
        });
      }
    }
  }, [currentApp, apps]);

  useEffect(() => {
    cacheApps(apps.map((app) => app.account));
  }, []);

  const addApp = (newApp: AccountType): void => {
    const isAlreadyExisting = apps.some((app) => app.account == newApp);
    if (isAlreadyExisting) {
      console.warn("Tried adding an app already tracked in local storage");
      return;
    }
    setApps((apps) => AppItem.array().parse([{ account: newApp }, ...apps]));
  };

  const removeApp = (appBeingRemoved: AccountType) => {
    const isExisting = apps.some((app) => app.account == appBeingRemoved);

    if (isExisting) {
      setApps((apps) =>
        AppItem.array().parse(
          apps.filter((app) => app.account !== appBeingRemoved)
        )
      );
    } else {
      throw new Error(
        `Failed to remove app ${appBeingRemoved}, does not exist.`
      );
    }
  };

  return {
    addApp,
    removeApp,
    apps,
  };
};
