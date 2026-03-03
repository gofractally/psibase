import { useBillingConfig } from "@shared/hooks/use-billing-config";

import { UserProfileSection } from "./components/user-profile-section";
import { UserSettingsSection } from "./components/user-settings-section";

export const SettingsPage = () => {
    const { data: billingConfig, isLoading: isLoadingBillingConfig } =
        useBillingConfig({ baseUrlIncludesSibling: false });
    const billingEnabled =
        !isLoadingBillingConfig && billingConfig?.enabled === true;

    return (
        <div className="p-4">
            <div className="mx-auto max-w-screen-md space-y-8">
                <UserProfileSection />
                {billingEnabled && (
                    <div className="border-t pt-8">
                        <UserSettingsSection />
                    </div>
                )}
            </div>
        </div>
    );
};
