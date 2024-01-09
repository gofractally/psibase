import { useEffect, useState } from "react";

import { siblingUrl } from "common/rpc.mjs";
import { AppletEntry, applets } from "../config";
import { Heading, Text } from "../components";

export const Dashboard = ({ currentUser }: { currentUser: string }) => {
    const [hrefs, setHrefs] = useState<{ [key: string]: string }>({});

    useEffect(() => {
        window.document.title = "Psibase Dashboard";

        const fetchHrefs = async () => {
            const newHrefs: { [key: string]: string } = {};

            for (const applet of applets) {
                newHrefs[applet.service] = await siblingUrl(
                    null,
                    applet.service
                );
            }

            setHrefs(newHrefs);
        };

        fetchHrefs();
    }, []);

    return (
        <div className="mx-auto max-w-screen-xl p-2 sm:px-8">
            <section className="mb-4 select-none rounded bg-gray-100 px-5 pb-5 pt-4">
                <Heading tag="h2" styledAs="h5" className="text-gray-600">
                    <span className="hidden md:inline">Welcome to the </span>
                    Psibase Technical Preview
                </Heading>
                <p className="mb-0 text-sm leading-snug sm:text-base">
                    This interface and all the applets below are hosted on and
                    served directly from the Psibase Technical Preview
                    blockchain. This is a prototype under active development and
                    will change as we continue adding and improving features.
                </p>
            </section>
            <Heading tag="h1" className="select-none text-gray-600">
                Featured applets
            </Heading>
            <div
                className="justify-center py-6 sm:grid"
                style={{ gridTemplateColumns: "repeat(auto-fill, 247px)" }}
            >
                {applets.map((a) => (
                    <AppletIcon
                        applet={a}
                        href={hrefs[a.service]}
                        disabled={a.requiresUser && !currentUser}
                        key={a.service}
                    />
                ))}
            </div>
        </div>
    );
};

export default Dashboard;

const AppletIcon = ({
    applet,
    href,
    disabled,
}: {
    applet: AppletEntry;
    href: string | undefined;
    disabled: boolean;
}) => {
    const { MobileIcon, DesktopIcon } = applet;
    const opacity = disabled ? "opacity-50" : "";
    const cursor = disabled ? "cursor-not-allowed" : "";

    let target = "_self";
    if (disabled) {
        href = undefined;
    } else if (applet.href) {
        href = applet.href;
        target = "_blank";
    }

    return (
        <a
            href={href}
            className={`select-none no-underline hover:text-gray-900 ${cursor}`}
            target={target}
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
