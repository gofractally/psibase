import { useAccountStatus } from "@/hooks/useAccountStatus";
import { useCurrentApp } from "@/hooks/useCurrentApp";

import { CreateAppAccountCard } from "./create-app-account-card";

export const AppExists = ({ children }: { children: React.ReactNode }) => {
    const currentApp = useCurrentApp();
    const { data: accountStatus } = useAccountStatus(currentApp);

    if (accountStatus == "Available") {
        return (
            <div className="flex h-dvh w-full items-center justify-center">
                <div className="max-w-screen-md p-4">
                    <CreateAppAccountCard />
                </div>
            </div>
        );
    }

    return children;
};
