import { useSystemTokenBalance } from "@/hooks/use-system-token-balance";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useSystemToken } from "@shared/hooks/use-system-token";
import { useSystemTokenPolicy } from "@shared/hooks/use-system-token-policy";

import { ResourceProvidersSection } from "./components/resource-providers-section";
import { UserProfileSection } from "./components/user-profile-section";
import { UserSettingsSection } from "./components/user-settings-section";

export const SettingsPage = () => {
    const { data: systemToken } = useSystemToken();
    const { data: currentUser } = useCurrentUser();
    const {
        billingEnabled,
        systemTokenUntransferable,
        isLoading: isNetworkLoading,
    } = useSystemTokenPolicy();
    const { hasBalance, isLoading: isBalanceLoading } = useSystemTokenBalance();

    const zeroBalance = !!currentUser && !hasBalance;
    const waitingForBalance =
        !!currentUser && !systemTokenUntransferable && isBalanceLoading;
    const showSelfService =
        !!systemToken &&
        billingEnabled &&
        !isNetworkLoading &&
        !waitingForBalance;

    return (
        <div className="p-4">
            <div className="mx-auto max-w-screen-md space-y-8">
                <UserProfileSection />
                {showSelfService && (
                    <div className="border-t pt-8">
                        <UserSettingsSection
                            readOnly={systemTokenUntransferable || zeroBalance}
                            disabledMessage={
                                !systemTokenUntransferable && zeroBalance
                                    ? "You need a system token balance before you can refill or resize your tank."
                                    : undefined
                            }
                        />
                    </div>
                )}
                <ResourceProvidersSection />
            </div>
        </div>
    );
};
