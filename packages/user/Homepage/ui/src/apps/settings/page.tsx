import { UserProfileSection } from "./components/user-profile-section";
import { SettingsSection } from "./components/settings-section";

export const SettingsPage = () => {
    return (
        <div className="p-4">
            <div className="mx-auto max-w-screen-md space-y-8">
                <UserProfileSection />
                <div className="border-t pt-8">
                    <SettingsSection />
                </div>
            </div>
        </div>
    );
};
