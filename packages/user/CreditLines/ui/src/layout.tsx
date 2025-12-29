import { Nav } from "@/components/nav";
import { supervisor } from "@shared/lib/supervisor";
import { Sidebar } from "./components/sidebar";
import { Outlet } from "react-router-dom";

export const Layout = () => {

    console.log("supervisor:", supervisor);
    return (
        <div className="mx-auto h-screen w-screen max-w-6xl border flex flex-col">
            <Nav />

            <div className="flex-1 grid grid-cols-5 overflow-hidden">
                <div className="border h-full  col-span-1 border-r">
                    <Sidebar />
                </div>

                <div className="border h-full  col-span-3 p-4 overflow-auto">
                    <Outlet />
                </div>

                <div className="border h-full  col-span-1 border-l">
                    Right Sidebar
                </div>
            </div>
        </div>
    );
};
