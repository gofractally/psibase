import * as React from "react";
import { Outlet, useLoaderData } from "react-router-dom";

import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@shadcn/resizable";
import { NavMenu } from "@components/nav-menu";
import { cn } from "@lib/utils";

import { type Account, accounts } from "../fixtures/data";

export const accountsLoader = () => {
    return { accounts };
};

export default function DefaultLayout() {
    const [isCollapsed, setIsCollapsed] = React.useState(false);

    const { accounts } = useLoaderData() as { accounts: Account[] };

    return (
        <div className="h-dvh max-h-dvh">
            <ResizablePanelGroup
                direction="horizontal"
                autoSaveId="main-panels"
            >
                <ResizablePanel
                    id="nav"
                    order={1}
                    collapsible={true}
                    minSize={15}
                    maxSize={20}
                    onCollapse={() => setIsCollapsed(true)}
                    onExpand={() => setIsCollapsed(false)}
                    className={cn(
                        isCollapsed &&
                            "min-w-[50px] transition-all duration-300 ease-in-out",
                    )}
                >
                    <NavMenu accounts={accounts} isCollapsed={isCollapsed} />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel minSize={30} id="body" order={2}>
                    <Outlet />
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
}
