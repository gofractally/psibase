import type { Ctx } from "@milkdown/ctx";

import { editorViewCtx } from "@milkdown/core";
import { useInstance } from "@milkdown/react";
import { linkSchema } from "@milkdown/preset-commonmark";
import {
    linkTooltipAPI,
    linkTooltipState,
} from "@milkdown/components/link-tooltip";
import { Link } from "lucide-react";

import { Button } from "@shadcn/button";
import { Separator } from "@shadcn/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shadcn/tooltip";

const insertLink = (ctx: Ctx) => {
    const view = ctx.get(editorViewCtx);
    const { selection, doc } = view.state;

    if (selection.empty) return;

    // already in edit mode
    if (ctx.get(linkTooltipState.key).mode === "edit") return;

    const has = doc.rangeHasMark(
        selection.from,
        selection.to,
        linkSchema.type(ctx),
    );
    // range already has link
    if (has) return;

    ctx.get(linkTooltipAPI.key).addLink(selection.from, selection.to);
};

export const ControlBar = () => {
    const [_, getEditor] = useInstance();
    const editor = getEditor();
    const linkHandler = () => editor?.action?.(insertLink);

    return (
        <div className="flex justify-center p-2">
            <div className="flex w-full max-w-prose items-center gap-2">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={linkHandler}
                        >
                            <Link className="h-4 w-4" />
                            <span className="sr-only">Link</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Link</TooltipContent>
                </Tooltip>
                <Separator orientation="vertical" className="mx-1 h-6" />
            </div>
        </div>
    );
};

export default ControlBar;
