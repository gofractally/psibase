import { useIsPrivateNetwork } from "@shared/hooks/use-is-private-network";
import { useSystemToken } from "@shared/hooks/use-system-token";

import { ResourceProvidersSection } from "./components/resource-providers-section";
import { UserProfileSection } from "./components/user-profile-section";
import { UserSettingsSection } from "./components/user-settings-section";

export const SettingsPage = () => {
    const { data: systemToken } = useSystemToken();
    const { billingEnabled, isPrivateNetwork } = useIsPrivateNetwork();

    return (
        <div className="p-4">
            <div className="mx-auto max-w-screen-md space-y-8">
                <UserProfileSection />
                {systemToken && billingEnabled && (
                    <div className="border-t pt-8">
                        <UserSettingsSection readOnly={isPrivateNetwork} />
                    </div>
                )}
                <ResourceProvidersSection />
            </div>
        </div>
    );
};
