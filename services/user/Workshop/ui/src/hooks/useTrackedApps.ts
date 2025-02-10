import { z } from "zod";
import { Account } from "@/lib/zodTypes";
import { useLocalStorage } from "@uidotdev/usehooks";
import { useLocation } from "react-router-dom";

type AccountType = z.infer<typeof Account>;

const AppItem = z.object({
  account: Account,
  owner: Account,
});

export const Apps = AppItem.array();

export const useTrackedApps = (currentUser: AccountType | null | undefined) => {
  const [apps, setApps] = useLocalStorage<z.infer<typeof Apps>>(
    "trackedApps",
    []
  );

  const location = useLocation();

  console.log(location, "is the location");

  const addApp = (newApp: AccountType): void => {
    const isAlreadyExisting = apps.some((app) => app.account == newApp);
    if (isAlreadyExisting) {
      console.warn("Tried adding an app already tracked in local storage");
      return;
    }
    setApps((apps) => [
      { account: newApp, owner: Account.parse(currentUser) },
      ...apps,
    ]);
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
    apps: apps.filter((app) => app.owner == currentUser),
  };
};
