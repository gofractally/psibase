import type { Ctx } from "@milkdown/ctx";
import type { LucideProps } from "lucide-react";

import React, { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
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
import { Node, ResolvedPos } from "@milkdown/prose/model";
import {
    linkTooltipAPI,
    linkTooltipState,
} from "@milkdown/components/link-tooltip";
import { Bold, Italic, Link, Strikethrough } from "lucide-react";

import { Separator } from "@shadcn/separator";
import { editorSelectionAtom } from "@components/markdown-editor";
import { Toggle } from "@shadcn/toggle";

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

interface ControlBarToggleProps {
    action?: (ctx: Ctx) => void;
    Icon: React.FC<Omit<LucideProps, "ref">>;
    active?: boolean;
    label: string;
}

const ControlBarToggle = ({
    action,
    Icon,
    active = false,
    label,
}: ControlBarToggleProps) => {
    // TODO: shadcs toggle buttons where appropriate
    const [_, getEditor] = useInstance();
    const editor = getEditor();

    if (!action) return null;

    return (
        <Toggle
            aria-label={label}
            pressed={active}
            onPressedChange={() => editor?.action?.(action)}
        >
            <Icon className="h-4 w-4" />
        </Toggle>
    );
};

export const ControlBar = () => {
    const [_, getEditor] = useInstance();
    const editor = getEditor();

    const selection = useAtomValue(editorSelectionAtom);

    const buttons = [
        "heading",
        "strong",
        "emphasis",
        "link",
        "inlineCode",
        "table",
        "blockquote",
        "code_block",
        "bullet_list",
        "ordered_list",
    ];

    const [active, setActive] = useState<string[]>([]);
    const [headingLevel, setHeadingLevel] = useState(0);

    useEffect(() => {
        if (selection) {
            setActive([]);
            const list: string[] = [];
            const { doc, selection: sel, schema } = selection;
            const { from, to } = sel;
            const { path, parent } = doc.resolve(from) as ResolvedPos & {
                path: (Node | number)[];
            };
            path.forEach((i) => {
                if (typeof i === "number") return;
                list.push(i.type.name);
            });
            Object.keys(schema.marks).forEach((m) => {
                if (
                    doc.rangeHasMark(
                        from === to ? from - 1 : from,
                        to,
                        schema.marks[m],
                    )
                )
                    list.push(schema.marks[m].name);
            });
            setActive(list);
            setHeadingLevel(parent.attrs?.level || 0);
        }
    }, [selection]);

    const cmd = (key: CmdKey<unknown>) => {
        // editor must be instantiated here before calling `callCommand`
        if (!editor) return;
        return callCommand(key);
    };

    return (
        <div className="flex justify-center p-2">
            <div className="flex w-full items-center gap-2">
                <ControlBarToggle
                    Icon={Bold}
                    action={cmd(toggleStrongCommand.key)}
                    active={active.includes("strong")}
                    label="Toggle bold"
                />
                <ControlBarToggle
                    Icon={Italic}
                    action={cmd(toggleEmphasisCommand.key)}
                    active={active.includes("emphasis")}
                    label="Toggle italic"
                />
                <ControlBarToggle
                    Icon={Strikethrough}
                    action={cmd(toggleStrikethroughCommand.key)}
                    active={active.includes("strike_through")}
                    label="Toggle strikethrough"
                />
                <Separator orientation="vertical" className="mx-1 h-6" />
                <ControlBarToggle
                    Icon={Link}
                    action={insertLink}
                    active={active.includes("link")}
                    label="Add or edit link"
                />
            </div>
        </div>
    );
};

export default ControlBar;
