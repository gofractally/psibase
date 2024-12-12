import type { Ctx } from "@milkdown/ctx";
import type { EditorView } from "@milkdown/prose/view";
import type { EditorState } from "@milkdown/prose/state";

import { editorViewCtx } from "@milkdown/core";
import { linkSchema } from "@milkdown/preset-commonmark";
import {
    configureLinkTooltip,
    linkTooltipAPI,
    linkTooltipState,
} from "@milkdown/components/link-tooltip";
import { TooltipProvider, tooltipFactory } from "@milkdown/plugin-tooltip";

import "../../styles/link-tooltip.css";

export { linkTooltipPlugin } from "@milkdown/components/link-tooltip";

export const insertLinkTooltip = tooltipFactory("CREATE_LINK");

export function tooltipPluginView(ctx: Ctx) {
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
            ctx.get(linkTooltipAPI.key).addLink(selection.from, selection.to);
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

export function linkTooltipConfig(ctx: Ctx) {
    ctx.set(insertLinkTooltip.key, {
        view: tooltipPluginView(ctx),
    });
    configureLinkTooltip(ctx);
}
