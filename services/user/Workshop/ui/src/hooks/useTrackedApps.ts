import { z } from "zod";
import { Account } from "@/lib/zodTypes";
import { useCurrentApp } from "./useCurrentApp";
import { useEffect } from "react";
import { useLocalStorage } from "@uidotdev/usehooks";

type AccountType = z.infer<typeof Account>;

const AppItem = z.object({
  account: Account,
});

export const Apps = AppItem.array();

export const useTrackedApps = () => {
  const [apps, setApps] = useLocalStorage<z.infer<typeof Apps>>(
    "trackedApps",
    []
  );

  const currentApp = useCurrentApp();

  useEffect(() => {
    const firstApp = apps[0];

    if (firstApp && firstApp.account !== currentApp) {
      console.log("current app is not the first app");
      const currentAppStored = apps.find((app) => app.account === currentApp);
      if (currentAppStored) {
        console.log("current app is stored already...");
        setApps((preExistingApps) => [
          currentAppStored,
          ...preExistingApps.filter((app) => app.account !== currentApp),
        ]);
      }
    }
  }, [currentApp, apps, setApps]);

  const addApp = (newApp: AccountType): void => {
    const isAlreadyExisting = apps.some((app) => app.account == newApp);
    if (isAlreadyExisting) {
      console.warn("Tried adding an app already tracked in local storage");
      return;
    }
    setApps((apps) => [{ account: newApp }, ...apps]);
  };

  const removeApp = (appBeingRemoved: AccountType) => {
    const isExisting = apps.some((app) => app.account == appBeingRemoved);

    if (isExisting) {
      setApps((apps) => apps.filter((app) => app.account !== appBeingRemoved));
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
