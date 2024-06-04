import type { Ctx } from "@milkdown/ctx";
import type { LucideProps } from "lucide-react";

import React from "react";
import { type CmdKey, editorViewCtx } from "@milkdown/core";
import { useInstance } from "@milkdown/react";
import { callCommand } from "@milkdown/utils";
import {
    linkSchema,
    toggleEmphasisCommand,
    toggleStrongCommand,
    wrapInBlockquoteCommand,
    wrapInBulletListCommand,
    wrapInOrderedListCommand,
} from "@milkdown/preset-commonmark";
import { toggleStrikethroughCommand } from "@milkdown/preset-gfm";
import {
    linkTooltipAPI,
    linkTooltipState,
} from "@milkdown/components/link-tooltip";
import { Bold, Italic, Link, Strikethrough } from "lucide-react";

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

interface ControlBarButtonProps {
    action?: (ctx: Ctx) => void;
    Icon: React.FC<Omit<LucideProps, "ref">>;
    children: React.ReactNode;
}

const ControlBarButton = ({
    action,
    Icon,
    children,
}: ControlBarButtonProps) => {
    const [_, getEditor] = useInstance();
    const editor = getEditor();

    if (!action) return null;

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => editor?.action?.(action)}
                >
                    <Icon className="h-4 w-4" />
                    <span className="sr-only">{children}</span>
                </Button>
            </TooltipTrigger>
            <TooltipContent>{children}</TooltipContent>
        </Tooltip>
    );
};

export const ControlBar = () => {
    const [_, getEditor] = useInstance();
    const editor = getEditor();

    const cmd = (key: CmdKey<unknown>) => {
        // editor must be intantiated here before calling `callCommand`
        if (!editor) return;
        return callCommand(key);
    };

    return (
        <div className="flex justify-center p-2">
            <div className="flex w-full max-w-prose items-center gap-2">
                <ControlBarButton
                    Icon={Bold}
                    action={cmd(toggleStrongCommand.key)}
                >
                    Bold
                </ControlBarButton>
                <ControlBarButton
                    Icon={Italic}
                    action={cmd(toggleEmphasisCommand.key)}
                >
                    Italic
                </ControlBarButton>
                <ControlBarButton
                    Icon={Strikethrough}
                    action={cmd(toggleStrikethroughCommand.key)}
                >
                    Strikethrough
                </ControlBarButton>
                <Separator orientation="vertical" className="mx-1 h-6" />
                <ControlBarButton Icon={Link} action={insertLink}>
                    Link
                </ControlBarButton>
            </div>
        </div>
    );
};

export default ControlBar;
