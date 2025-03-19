import { ResizableHandle, ResizablePanelGroup } from "./ui/resizable";
import { ResizablePanel } from "./ui/resizable";

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
        <div className="flex h-[calc(100dvh-theme(spacing.20))] flex-col">
            {header}
            <div className="flex-1 overflow-hidden">
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
                            className="border-r"
                        >
                            {left}
                        </ResizablePanel>
                        <ResizableHandle withHandle />
                        <ResizablePanel defaultSize={75}>
                            {right}
                        </ResizablePanel>
                    </ResizablePanelGroup>
                )}
            </div>
        </div>
    );
};
