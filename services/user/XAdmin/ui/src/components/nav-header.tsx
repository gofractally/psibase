import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MenuContent } from "./menu-content";
import { NavLink } from "react-router-dom";
import { useStatuses } from "../hooks/useStatuses";

export const NavHeader = () => {
    const { data: status } = useStatuses();

    const menuItems = [
        "Dashboard",
        "Peers",
        "Logs",
        "Configuration",
        ...(status && status.includes("needgenesis") ? ["Boot"] : []),
    ];

    return (
        <header className="mx-auto my-4 flex max-w-7xl justify-between">
            <div className="mr-12 flex items-center">
                <img src="/psibase.svg" alt="Psibase Logo" />
            </div>
            <h1 className=" scroll-m-20 text-4xl font-extrabold tracking-tight">
                Admin Panel
            </h1>
            <div className="flex gap-3">
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
                <MenuContent />
            </div>
        </header>
    );
};
