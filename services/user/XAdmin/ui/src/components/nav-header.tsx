import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MenuContent } from "./menu-content";
import { NavLink } from "react-router-dom";
import { useStatuses } from "../hooks/useStatuses";

const Loading = () => <div>Loading...</div>;

export const NavHeader = ({
    title,
    condense = false,
}: {
    title?: string;
    condense?: boolean;
}) => {
    const { data: status, isLoading } = useStatuses();

    const isBootable = status && status.includes("needgenesis");

    const menuItems = [
        "Dashboard",
        "Peers",
        "Logs",
        "Configuration",
        ...(isBootable ? ["Boot"] : []),
    ];

    if (isLoading) {
        return <Loading />;
    }

    return (
        <header className="mx-auto my-4 flex max-w-7xl justify-between">
            <div className="mr-12 flex items-center">
                <img src="/psibase.svg" alt="Psibase Logo" />
            </div>
            {title && (
                <h1 className=" scroll-m-20 text-4xl font-extrabold tracking-tight">
                    {title}
                </h1>
            )}
            <div className="flex gap-3">
                {!condense && (
                    <Tabs>
                        <TabsList>
                            {menuItems.map((item) => (
                                <NavLink key={item} to={item}>
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
                <MenuContent condense />
            </div>
        </header>
    );
};
