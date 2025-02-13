import { NavLink } from "react-router-dom";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { HoverBorderGradient } from "./hover-border-gradient";
import { MenuContent } from "./menu-content";
import { useBranding } from "../hooks/useBranding";
import { useStatuses } from "../hooks/useStatuses";

const Loading = () => <div>Loading...</div>;

export const NavHeader = ({ title }: { title?: string }) => {
    const { data: networkName } = useBranding();
    const { data: status, isLoading } = useStatuses();

    const isBootable = status && status.includes("needgenesis");

    const menuItems = [
        "Dashboard",
        "Peers",
        "Logs",
        "Configuration",
        "Keys and devices",
        ...(isBootable ? ["Boot"] : []),
    ];

    if (isLoading) {
        return <Loading />;
    }

    return (
        <header className="mx-auto my-4 flex max-w-7xl justify-between">
            <div className="mr-12 flex items-center">
                <div className="flex justify-center text-center">
                    <HoverBorderGradient
                        as="div"
                        containerClassName="rounded-full"
                        className="flex items-center space-x-2 bg-white text-black dark:bg-black dark:text-white"
                    >
                        <span>{networkName || "Network"}</span>
                    </HoverBorderGradient>
                </div>
            </div>
            {title && (
                <h1 className=" scroll-m-20 text-4xl font-extrabold tracking-tight">
                    {title}
                </h1>
            )}
            <div className="flex gap-3">
                {!isBootable && (
                    <Tabs>
                        <TabsList>
                            {menuItems.map((item) => (
                                <NavLink
                                    key={item}
                                    to={item.split(" ").join("-").toLowerCase()}
                                >
                                    {({ isActive }) => (
                                        <TabsTrigger
                                            value={item}
                                            data-state={
                                                isActive ? "active" : "inactive"
                                            }
                                        >
                                            {item}
                                        </TabsTrigger>
                                    )}
                                </NavLink>
                            ))}
                        </TabsList>
                    </Tabs>
                )}
                <MenuContent condense={isBootable} />
            </div>
        </header>
    );
};
