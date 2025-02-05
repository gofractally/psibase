import { z } from "zod";
import { Account } from "@/lib/zodTypes";
import { useLocalStorage } from "@uidotdev/usehooks";

type AccountType = z.infer<typeof Account>;

const AppItem = z.object({
  appName: Account,
  owner: Account,
});

export const Apps = AppItem.array();

export const useTrackedApps = (currentUser: AccountType | null | undefined) => {
  const [apps, setApps] = useLocalStorage<z.infer<typeof Apps>>(
    "trackedApps",
    []
  );

  const addApp = (newApp: AccountType): void => {
    const isAlreadyExisting = apps.some((app) => app.appName == newApp);
    if (isAlreadyExisting) {
      console.warn("Tried adding an app already tracked in local storage");
      return;
    }
    setApps((apps) => [
      { appName: newApp, owner: Account.parse(currentUser) },
      ...apps,
    ]);
  };

  const removeApp = (appBeingRemoved: AccountType) => {
    const isExisting = apps.some((app) => app.appName == appBeingRemoved);

    if (isExisting) {
      setApps((apps) => apps.filter((app) => app.appName !== appBeingRemoved));
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
