import type { MilkdownPlugin, Ctx } from "@milkdown/ctx";

import { atom, useSetAtom } from "jotai";
import {
    defaultValueCtx,
    editorViewCtx,
    editorViewOptionsCtx,
    Editor as MilkdownEditor,
    rootCtx,
    schemaCtx,
} from "@milkdown/core";
// import { $view } from "@milkdown/utils";
import { nord } from "@milkdown/theme-nord";
import { Milkdown, useEditor } from "@milkdown/react";
import { commonmark, linkSchema } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { listItemBlockComponent } from "@milkdown/components/list-item-block";
import {
    configureLinkTooltip,
    linkTooltipAPI,
    linkTooltipPlugin,
    linkTooltipState,
} from "@milkdown/components/link-tooltip";
import { TooltipProvider, tooltipFactory } from "@milkdown/plugin-tooltip";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { history } from "@milkdown/plugin-history";
// import { math, mathBlockSchema } from "@milkdown/plugin-math";
// import { diagram, diagramSchema } from "@milkdown/plugin-diagram";
// import { useNodeViewFactory } from "@prosemirror-adapter/react";
import { Node, Schema } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";
import type { EditorState } from "@milkdown/prose/state";

import {
    selectionCtx,
    selectionListener,
} from "@lib/editor/plugin-selection-listener";

// import { MathBlock, MermaidDiagram } from "./editor";
// import { MathBlock } from "./editor";

import "@milkdown/theme-nord/style.css";
// import "katex/dist/katex.min.css";
import "../styles/editor.css";
import "../styles/link-tooltip.css";

export const editorSelectionAtom = atom<{
    doc: Node;
    selection: any;
    schema: Schema<any, any>;
} | null>(null);

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
    // const nodeViewFactory = useNodeViewFactory();
    const setSelection = useSetAtom(editorSelectionAtom);

    // const mathPlugins: MilkdownPlugin[] = useMemo(() => {
    //     return [
    //         $view(mathBlockSchema.node, () =>
    //             nodeViewFactory({
    //                 component: () => <MathBlock readOnly={readOnly} />,
    //                 stopEvent: () => true,
    //             }),
    //         ),
    //         math,
    //     ].flat();
    // }, [nodeViewFactory]);

    // const diagramPlugins: MilkdownPlugin[] = useMemo(() => {
    //     return [
    //         diagram,
    //         $view(diagramSchema.node, () =>
    //             nodeViewFactory({
    //                 component: () => <MermaidDiagram readOnly={readOnly} />,
    //                 stopEvent: () => true,
    //             }),
    //         ),
    //     ].flat();
    // }, [nodeViewFactory]);

    const insertLinkTooltip = tooltipFactory("CREATE_LINK");

    function tooltipPluginView(ctx: Ctx) {
        return (_view: EditorView) => {
            const content = document.createElement("div");
            const provider = new TooltipProvider({
                content,
                shouldShow: (view: EditorView) => {
                    const { selection, doc } = view.state;
                    const has = doc.rangeHasMark(
                        selection.from,
                        selection.to,
                        linkSchema.type(ctx),
                    );
                    if (has || selection.empty) return false;

                    return true;
                },
            });

            content.onmousedown = (e: MouseEvent) => {
                e.preventDefault();
                const view = ctx.get(editorViewCtx);
                const { selection } = view.state;
                ctx.get(linkTooltipAPI.key).addLink(
                    selection.from,
                    selection.to,
                );
                provider.hide();
            };

            return {
                update: (updatedView: EditorView, prevState: EditorState) => {
                    if (ctx.get(linkTooltipState.key).mode === "edit") return;
                    provider.update(updatedView, prevState);
                },
                destroy: () => {
                    provider.destroy();
                    content.remove();
                },
            };
        };
    }

    useEditor((root) =>
        MilkdownEditor.make()
            .config(nord)
            .config((ctx) => {
                ctx.set(rootCtx, root);
                ctx.set(defaultValueCtx, initialValue);
                ctx.set(insertLinkTooltip.key, {
                    view: tooltipPluginView(ctx),
                });
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
                const slistener = ctx.get(selectionCtx);
                slistener.selection((_, selection, doc) => {
                    const schema = ctx.get(schemaCtx);
                    setSelection({ doc, selection, schema });
                });
            })
            .config((ctx) => {
                ctx.update(editorViewOptionsCtx, (prev) => ({
                    ...prev,
                    editable: () => !readOnly,
                }));
            })
            .use(listener)
            .use(selectionListener)
            .use(commonmark)
            .use(gfm)
            .use(history)
            .use(listItemBlockComponent)
            // .use(mathPlugins)
            // .use(diagramPlugins)
            .use(linkTooltipPlugin)
            .use(insertLinkTooltip),
    );

    return <Milkdown />;
};

export default MarkdownEditor;
