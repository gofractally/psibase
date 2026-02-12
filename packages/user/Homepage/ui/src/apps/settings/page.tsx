import { UserProfileSection } from "./components/user-profile-section";
import { UserSettingsSection } from "./components/user-settings-section";

export const SettingsPage = () => {
    return (
        <div className="p-4">
            <div className="mx-auto max-w-screen-md space-y-8">
                <UserProfileSection />
                <div className="border-t pt-8">
                    <UserSettingsSection />
                </div>
            </div>
        </div>
    );
};
