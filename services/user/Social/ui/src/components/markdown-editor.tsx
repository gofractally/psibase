import type { MilkdownPlugin } from "@milkdown/ctx";

import { useMemo } from "react";
import {
    defaultValueCtx,
    editorViewOptionsCtx,
    Editor as MilkdownEditor,
    rootCtx,
} from "@milkdown/core";
import { $view } from "@milkdown/utils";
import { nord } from "@milkdown/theme-nord";
import { Milkdown, useEditor } from "@milkdown/react";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { listItemBlockComponent } from "@milkdown/components/list-item-block";
import {
    configureLinkTooltip,
    linkTooltipPlugin,
} from "@milkdown/components/link-tooltip";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { history } from "@milkdown/plugin-history";
import { math, mathBlockSchema } from "@milkdown/plugin-math";
import { diagram, diagramSchema } from "@milkdown/plugin-diagram";
import { useNodeViewFactory } from "@prosemirror-adapter/react";

import { MathBlock, MermaidDiagram } from "./editor";

import "@milkdown/theme-nord/style.css";
import "katex/dist/katex.min.css";
import "../styles/editor.css";

interface EditorProps {
    initialValue: string;
    updateMarkdown: (value: string) => void;
    readOnly?: boolean;
}

// NOTE: This should only be used within a <MilkdownProvider /> context
export const MarkdownEditor = ({
    initialValue,
    updateMarkdown,
    readOnly = false,
}: EditorProps) => {
    const nodeViewFactory = useNodeViewFactory();

    const mathPlugins: MilkdownPlugin[] = useMemo(() => {
        return [
            $view(mathBlockSchema.node, () =>
                nodeViewFactory({
                    component: () => <MathBlock readOnly={readOnly} />,
                    stopEvent: () => true,
                }),
            ),
            math,
        ].flat();
    }, [nodeViewFactory]);

    const diagramPlugins: MilkdownPlugin[] = useMemo(() => {
        return [
            diagram,
            $view(diagramSchema.node, () =>
                nodeViewFactory({
                    component: () => <MermaidDiagram readOnly={readOnly} />,
                    stopEvent: () => true,
                }),
            ),
        ].flat();
    }, [nodeViewFactory]);

    const { get } = useEditor((root) =>
        MilkdownEditor.make()
            .config(nord)
            .config((ctx) => {
                ctx.set(rootCtx, root);
                ctx.set(defaultValueCtx, initialValue);
                configureLinkTooltip(ctx);
            })
            .config((ctx) => {
                if (readOnly) return;
                const listener = ctx.get(listenerCtx);
                listener.markdownUpdated((_ctx, md, prevMd) => {
                    if (md === prevMd) return;
                    updateMarkdown(md);
                });
            })
            .config((ctx) => {
                ctx.update(editorViewOptionsCtx, (prev) => ({
                    ...prev,
                    editable: () => !readOnly,
                }));
            })
            .use(listener)
            .use(commonmark)
            .use(gfm)
            .use(history)
            .use(listItemBlockComponent)
            .use(mathPlugins)
            .use(diagramPlugins)
            .use(linkTooltipPlugin),
    );

    return <Milkdown />;
};

export default MarkdownEditor;
