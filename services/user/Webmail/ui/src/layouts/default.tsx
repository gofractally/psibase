import * as React from "react";
import { Outlet } from "react-router-dom";

import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@shadcn/resizable";
import { Toaster } from "@shadcn/sonner";

import { NavMenu } from "@components";
import { cn } from "@lib/utils";

export default function DefaultLayout() {
    const [isCollapsed, setIsCollapsed] = React.useState(false);

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
                    <NavMenu isCollapsed={isCollapsed} />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel minSize={30} id="body" order={2}>
                    <Outlet />
                </ResizablePanel>
            </ResizablePanelGroup>
            <Toaster />
        </div>
    );
}
