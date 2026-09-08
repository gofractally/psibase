import { useSystemToken } from "@shared/hooks/use-system-token";
import { homepage } from "@shared/lib/plugins";

import { UserProfileSection } from "./components/user-profile-section";
import { UserSettingsSection } from "./components/user-settings-section";

export const SettingsPage = () => {
    const { data: systemToken } = useSystemToken(homepage.tokens.graphql);

    return (
        <div className="p-4">
            <div className="mx-auto max-w-screen-md space-y-8">
                <UserProfileSection />
                {systemToken && (
                    <div className="border-t pt-8">
                        <UserSettingsSection />
                    </div>
                )}
            </div>
        </div>
    );
};
