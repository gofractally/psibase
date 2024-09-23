import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNodeViewContext } from "@prosemirror-adapter/react";
import mermaid from "mermaid";
import clsx from "clsx";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shadcn/tabs";
import { Button } from "@shadcn/button";

export const MermaidDiagram = ({
    readOnly = false,
}: {
    readOnly?: boolean;
}) => {
    const { node, setAttrs, selected } = useNodeViewContext();

    const code = useMemo(() => node.attrs.value, [node.attrs.value]);
    const id = node.attrs.identity;
    const codePanel = useRef<HTMLDivElement>(null);
    const codeInput = useRef<HTMLTextAreaElement>(null);

    const defaultTab = readOnly ? "preview" : "source";
    const [value, setValue] = useState(defaultTab);
    const rendering = useRef(false);

    const renderMermaid = useCallback(async () => {
        const container = codePanel.current;
        if (!container) return;

        if (code.length === 0) return;
        if (rendering.current) return;

        mermaid.initialize({
            startOnLoad: false,
            theme: "default",
        });
        rendering.current = true;
        const { svg, bindFunctions } = await mermaid.render(id, code);
        rendering.current = false;
        container.innerHTML = svg;
        bindFunctions?.(container);
    }, [code, id]);

    useEffect(() => {
        requestAnimationFrame(() => {
            renderMermaid();
        });
    }, [renderMermaid, value]);

    if (readOnly) {
        return (
            <div
                ref={codePanel}
                className={clsx(
                    "flex justify-center py-3",
                    value !== "preview" ? "hidden" : "",
                )}
            />
        );
    }

    return (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-2.5">
            <Tabs
                contentEditable={false}
                className={selected ? "ring-2 ring-offset-2" : ""}
                onValueChange={setValue}
                value={value}
            >
                <TabsList>
                    <TabsTrigger value="preview">Preview</TabsTrigger>
                    <TabsTrigger value="source">Source</TabsTrigger>
                </TabsList>
                <TabsContent value="preview" forceMount>
                    <div
                        ref={codePanel}
                        className={clsx(
                            "flex justify-center py-3",
                            value !== "preview" ? "hidden" : "",
                        )}
                    />
                </TabsContent>
                <TabsContent value="source" className="relative">
                    <textarea
                        className="block h-48 w-full bg-slate-800 font-mono text-gray-50"
                        ref={codeInput}
                        defaultValue={code}
                    />
                    <Button
                        className="absolute bottom-full right-0 mb-1.5"
                        onClick={() => {
                            setAttrs({ value: codeInput.current?.value || "" });
                            setValue("preview");
                        }}
                    >
                        Save
                    </Button>
                </TabsContent>
            </Tabs>
        </div>
    );
};
