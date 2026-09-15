import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@shared/shadcn/ui/resizable";

export type DisplayMode = "left" | "right" | "both";

export const TwoColumnSelect = ({
    left,
    right,
    header,
    displayMode = "both",
}: {
    left: React.ReactNode;
    right: React.ReactNode;
    header?: React.ReactNode;
    displayMode: DisplayMode;
}) => {
    return (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            {header}
            {displayMode === "right" ? (
                <div className="min-h-0 flex-1 overflow-hidden">{right}</div>
            ) : displayMode === "left" ? (
                <div className="min-h-0 flex-1 overflow-hidden">{left}</div>
            ) : (
                <ResizablePanelGroup
                    direction="horizontal"
                    className="min-h-0 flex-1"
                >
                    <ResizablePanel
                        defaultSize={40}
                        minSize={20}
                        maxSize={40}
                        className="min-h-0 overflow-hidden border-r"
                    >
                        <div className="flex h-full min-h-0 flex-col overflow-hidden">
                            {left}
                        </div>
                    </ResizablePanel>
                    <ResizableHandle withHandle />
                    <ResizablePanel
                        defaultSize={75}
                        className="min-h-0 overflow-hidden"
                    >
                        <div className="flex h-full min-h-0 flex-col overflow-hidden">
                            {right}
                        </div>
                    </ResizablePanel>
                </ResizablePanelGroup>
            )}
        </div>
    );
};
