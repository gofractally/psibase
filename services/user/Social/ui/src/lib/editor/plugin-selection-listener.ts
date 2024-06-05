import { type Ctx, createSlice, MilkdownPlugin } from "@milkdown/ctx";
import { Plugin, PluginKey, Selection } from "@milkdown/prose/state";
import { Node } from "@milkdown/prose/model";
import { InitReady, prosePluginsCtx } from "@milkdown/core";

import { debounce } from "@lib/utils";

type SelectionListener = (ctx: Ctx, selection: Selection, doc: Node) => void;

export class SelectionManager {
    selectionListeners: SelectionListener[] = [];

    get listeners() {
        return {
            selection: this.selectionListeners,
        };
    }

    selection(fn: SelectionListener) {
        this.selectionListeners.push(fn);
        return this;
    }
}

export const selectionCtx = createSlice(
    new SelectionManager(),
    "selection-listener",
);

export const key = new PluginKey("MILKDOWN_SELECTION_LISTENER");

export const selectionListener: MilkdownPlugin = (ctx: Ctx) => {
    ctx.inject(selectionCtx, new SelectionManager());

    return async () => {
        await ctx.wait(InitReady);
        const listener = ctx.get(selectionCtx);
        const { listeners } = listener;

        let prevSelection: Selection | null = null;

        const plugin = new Plugin({
            key,
            state: {
                init: () => {
                    // do nothing
                },
                apply: (tr) => {
                    if (prevSelection && tr.selection.eq(prevSelection)) return;

                    const handler = debounce(() => {
                        const { selection, doc } = tr;
                        if (
                            listeners.selection.length > 0 &&
                            (prevSelection == null ||
                                !prevSelection.eq(selection))
                        ) {
                            listeners.selection.forEach((fn) => {
                                fn(ctx, selection, doc);
                            });
                        }
                        prevSelection = tr.selection;
                    }, 200);

                    return handler();
                },
            },
        });

        ctx.update(prosePluginsCtx, (x) => x.concat(plugin));
    };
};
