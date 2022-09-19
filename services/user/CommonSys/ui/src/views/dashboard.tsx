import { useEffect } from "react";

import { AppletEntry, appletPrefix, applets } from "../config";
import { Heading } from "../components";

export const Dashboard = ({ currentUser }: { currentUser: string }) => {
    useEffect(() => {
        window.document.title = "Psibase Dashboard";
    }, []);

    return (
        <div className="p-2 sm:px-8">
            <Heading tag="h1" className="text-gray-600">
                Featured applets
            </Heading>
            <div
                className="justify-center py-6 sm:grid"
                style={{ gridTemplateColumns: "repeat(auto-fill, 247px)" }}
            >
                {applets.map((a) => (
                    <AppletIcon
                        applet={a}
                        key={a.service}
                        disabled={a.requiresUser && !currentUser}
                    />
                ))}
            </div>
        </div>
    );
};

export default Dashboard;

const AppletIcon = ({
    applet,
    disabled,
}: {
    applet: AppletEntry;
    disabled: boolean;
}) => {
    const { MobileIcon, DesktopIcon } = applet;
    const opacity = disabled ? "opacity-50" : "";
    const cursor = disabled ? "cursor-not-allowed" : "";
    return (
        <a
            href={disabled ? undefined : `${appletPrefix}${applet.service}`}
            className={`select-none no-underline hover:text-gray-900 ${cursor}`}
        >
            <div
                className={`-mx-2 flex items-center gap-2 p-4 hover:bg-gray-100 sm:h-[184px] sm:w-[247px] sm:flex-col sm:justify-center sm:gap-3 ${opacity}`}
            >
                <MobileIcon className="h-10 w-10 sm:hidden" />
                <DesktopIcon className="hidden h-24 w-24 sm:block" />
                <Heading tag="h2" styledAs="h6">
                    {applet.title}
                </Heading>
            </div>
        </a>
    );
};
