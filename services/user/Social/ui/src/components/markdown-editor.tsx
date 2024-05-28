import {
    defaultValueCtx,
    editorViewOptionsCtx,
    Editor as MilkdownEditor,
    rootCtx,
} from "@milkdown/core";
import { nord } from "@milkdown/theme-nord";
import { Milkdown, useEditor } from "@milkdown/react";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { listItemBlockComponent } from "@milkdown/components/list-item-block";
import { listener, listenerCtx } from "@milkdown/plugin-listener";

import "@milkdown/theme-nord/style.css";
import "../styles/editor.css";

// NOTE: This should only be used within a <MilkdownProvider /> context
export const MarkdownEditor = ({
    initialValue,
    updateMarkdown,
    readOnly = false,
}: {
    initialValue: string;
    updateMarkdown: (value: string) => void;
    readOnly?: boolean;
}) => {
    const { get } = useEditor((root) =>
        MilkdownEditor.make()
            .config(nord)
            .config((ctx) => {
                ctx.set(rootCtx, root);
                ctx.set(defaultValueCtx, initialValue);
            })
            .config((ctx) => {
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
            .use(listItemBlockComponent),
    );

    return <Milkdown />;
};
export default MarkdownEditor;
