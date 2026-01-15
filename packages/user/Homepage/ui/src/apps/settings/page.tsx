import { LoginRequired } from "@/components/login-required";
import { Settings } from "lucide-react";

import { UserProfileSection } from "./components/user-profile-section";
import { UserSettingsSection } from "./components/user-settings-section";

export const SettingsPage = () => {
    return (
        <LoginRequired
            appName="User Settings"
            appIcon={<Settings className="h-6 w-6" />}
            appDescription="Manage your profile and settings."
        >
            <div className="p-4">
                <div className="mx-auto max-w-screen-md space-y-8">
                    <UserProfileSection />
                    <div className="border-t pt-8">
                        <UserSettingsSection />
                    </div>
                </div>
            </div>
        </LoginRequired>
    );
};
