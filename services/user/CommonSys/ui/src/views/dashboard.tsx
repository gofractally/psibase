import { useEffect } from "react";

import { AppletEntry, appletPrefix, applets } from "../config";
import { Heading, Text } from "../components";

export const Dashboard = () => {
    useEffect(() => {
        window.document.title = "Psibase Dashboard";
    }, []);

    return (
        <div className="p-2 sm:px-8">
            <Heading tag="h1" className="text-gray-600">
                Featured applications
            </Heading>
            <Text size="base">Click an app below to open it.</Text>
            <div
                className="justify-center py-6 sm:grid"
                style={{ gridTemplateColumns: "repeat(auto-fill, 247px)" }}
            >
                {applets.map((a) => (
                    <AppletIcon applet={a} key={a.contract} />
                ))}
            </div>
        </div>
    );
};

export default Dashboard;

const AppletIcon = ({ applet }: { applet: AppletEntry }) => {
    return (
        <a
            href={`${appletPrefix}${applet.contract}`}
            className="select-none no-underline hover:text-gray-900"
        >
            <div className="-mx-2 flex items-center gap-2 p-4 hover:bg-gray-100 sm:h-[184px] sm:w-[247px] sm:flex-col sm:justify-center sm:gap-3">
                <img src={applet.mobileIcon} className="h-10 w-10 sm:hidden" />
                <img
                    src={applet.desktopIcon}
                    className="hidden h-24 w-24 sm:block"
                />
                <Heading tag="h2" styledAs="h6">
                    {applet.title}
                </Heading>
            </div>
        </a>
    );
};
