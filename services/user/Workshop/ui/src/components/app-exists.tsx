import { useAccountStatus } from "@/hooks/useAccountStatus";
import { useCurrentApp } from "@/hooks/useCurrentApp";
import { CreateAppAccountCard } from "./create-app-account-card";

export const AppExists = ({ children }: { children: React.ReactNode }) => {
  const currentApp = useCurrentApp();
  const { data: accountStatus } = useAccountStatus(currentApp);

  if (accountStatus == "Available") {
    return (
      <div className="h-dvh w-full flex items-center justify-center">
        <div className="p-4 max-w-screen-md">
          <CreateAppAccountCard />
        </div>
      </div>
    );
  }

  return children;
};
