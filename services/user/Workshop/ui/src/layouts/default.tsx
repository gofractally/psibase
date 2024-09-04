import * as React from "react";
import { Outlet } from "react-router-dom";

import { NavMenu } from "@components";
import { cn } from "@lib/utils";

export default function DefaultLayout() {
    // const [isCollapsed, setIsCollapsed] = React.useState(false);

    return (
        <div className="h-dvh max-h-dvh">
            <div className="flex h-full">
                <div
                    className={cn(
                        "w-64 transition-all duration-300 ease-in-out",
                    )}
                >
                    <NavMenu />
                </div>
                <div className="ml-8 flex-1">
                    <Outlet />
                </div>
            </div>
        </div>
    );
}
