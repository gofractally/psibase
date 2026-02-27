import { useSystemToken } from "@shared/hooks/use-system-token";

import { UserProfileSection } from "./components/user-profile-section";
import { UserSettingsSection } from "./components/user-settings-section";

export const SettingsPage = () => {
    const { data: systemToken } = useSystemToken();

    return (
        <div className="p-4">
            <div className="mx-auto max-w-screen-md space-y-8">
                <UserProfileSection />
                {systemToken?.id && (
                    <div className="border-t pt-8">
                        <UserSettingsSection />
                    </div>
                )}
            </div>
        </div>
    );
};
