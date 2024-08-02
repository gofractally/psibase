import { useEffect, useMemo, useRef, useState } from "react";

import { katexOptionsCtx } from "@milkdown/plugin-math";
import { useInstance } from "@milkdown/react";
import { useNodeViewContext } from "@prosemirror-adapter/react";
import katex from "katex";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shadcn/tabs";
import { Button } from "@shadcn/button";

export const MathBlock = ({ readOnly = false }: { readOnly?: boolean }) => {
    const { node, setAttrs, selected } = useNodeViewContext();

    const code = useMemo(() => node.attrs.value, [node.attrs.value]);
    const codePanel = useRef<HTMLDivElement>(null);
    const codeInput = useRef<HTMLTextAreaElement>(null);

    const defaultTab = readOnly ? "preview" : "source";
    const [value, setValue] = useState(defaultTab);
    const [loading, getEditor] = useInstance();

    useEffect(() => {
        requestAnimationFrame(() => {
            if (!codePanel.current || value !== "preview" || loading) return;

            try {
                katex.render(
                    code,
                    codePanel.current,
                    getEditor().ctx.get(katexOptionsCtx.key),
                );
            } catch {}
        });
    }, [code, getEditor, loading, value]);

    if (readOnly) {
        return <div className="py-3 text-center" ref={codePanel} />;
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
                <TabsContent value="preview">
                    <div className="py-3 text-center" ref={codePanel} />
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
