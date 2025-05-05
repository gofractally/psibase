import { useAccountStatus } from "@/hooks/useAccountStatus";
import { useCurrentFractal } from "@/hooks/useCurrentFractal";

import { CreateAppAccountCard } from "./create-app-account-card";

export const AppExists = ({ children }: { children: React.ReactNode }) => {
    const currentFractal = useCurrentFractal();
    const { data: accountStatus } = useAccountStatus(currentFractal);

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
