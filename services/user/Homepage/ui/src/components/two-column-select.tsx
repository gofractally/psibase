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
        <div className="flex h-full flex-col">
            {header}
            {displayMode === "right" ? (
                right
            ) : displayMode === "left" ? (
                left
            ) : (
                <ResizablePanelGroup direction="horizontal">
                    <ResizablePanel
                        defaultSize={40}
                        minSize={20}
                        maxSize={40}
                        className="overflow-y-auto border-r"
                    >
                        {left}
                    </ResizablePanel>
                    <ResizableHandle withHandle />
                    <ResizablePanel defaultSize={75}>{right}</ResizablePanel>
                </ResizablePanelGroup>
            )}
        </div>
    );
};
