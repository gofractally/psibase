import { MilkdownProvider } from "@milkdown/react";
import { ProsemirrorAdapterProvider } from "@prosemirror-adapter/react";

import { EditorRef, MarkdownEditor } from "@components";
import { useLocalStorage } from "@hooks";
import { useRef } from "react";
import { Button } from "@shadcn/button";

const defaultMarkdown = `# Milkdown

We want to implement all the features in this document.
- These are from the Milkdown documentation [Playground](https://milkdown.dev/playground)
- [usePlayground.ts](https://github.com/Milkdown/website/blob/main/src/components/playground-editor/usePlayground.ts)

## Tasks remaining
- [x] Get task lists rendering properly
- [ ] Turn on emoji \`:+1:\` menu
- [ ] Turn on slash commands menu
- [ ] Turn on tooltip? What is tooltip exactly?
- [ ] Improve code blocks with \`milkdown-plugin-shiki\`
- [ ] TeX math support
- [ ] Mermaid diagrams
- [ ] Other styles
- [ ] How to embed YouTube videos? (not proven out by playground yet)
- [ ] Implement the control bar, preferably with shadcn/ui components
- [ ] Implement the renderer with \`react-markdown\`
- [ ] Persist these documents to local storage for mock publishing, editing and viewing

## The test document

![greeting bear](https://milkdown.dev/polar.jpeg)

> Milkdown is a WYSIWYG markdown editor framework.
>
> 🍼 Here is the [repo](https://github.com/Milkdown/milkdown) (right click to open link). \
> We ~~only support commonmark~~. GFM is also supported!

You can check the output markdown text in **two columns editing**.

* Features
  * [x] 📝 **WYSIWYG Markdown** - Write markdown in an elegant way
  * [x] 🎨 **Themable** - Theme can be shared and used with npm packages
  * [x] 🎮 **Hackable** - Support your awesome idea by plugin
  * [x] 🦾 **Reliable** - Built on top of [prosemirror](https://prosemirror.net/) and [remark](https://github.com/remarkjs/remark)
  * [x] ⚡ **Slash & Tooltip** - Write fast for everyone, driven by plugin
  * [x] 🧮 **Math** - LaTeX math equations support, driven by plugin
  * [x] 📊 **Table** - Table support with fluent ui, driven by plugin
  * [x] 📰 **Diagram** - Diagram support with [mermaid](https://mermaid-js.github.io/mermaid/#/), driven by plugin
  * [x] 🍻 **Collaborate** - Shared editing support with [yjs](https://docs.yjs.dev/), driven by plugin
  * [x] 💾 **Clipboard** - Support copy and paste markdown, driven by plugin
  * [x] 👍 **Emoji** - Support emoji shortcut and picker, driven by plugin
* Made by
  * Programmer: [Mirone](https://github.com/Milkdown)
  * Designer: [Mirone](https://github.com/Milkdown)

***

You can add \`inline code\` and code block:

\`\`\`javascript
function main() {
  console.log('Hello milkdown!');
}
\`\`\`

> Tips: use \`<mod>+<enter>\` to exit blocks such as code block.

***

You can type \`|3x2|<space>\` to create a table:

| First Header   |    Second Header   |
| -------------- | :----------------: |
| Content Cell 1 | \`Content\` Cell 1 |
| Content Cell 2 | **Content** Cell 2 |

***

Math is supported by [TeX expression](https://en.wikipedia.org/wiki/TeX).

Now we have some inline math: $E = mc^2$. You can click to edit it.

Math block is also supported.

$$
\begin{aligned}
T( (v_1 + v_2) \otimes w) &= T(v_1 \otimes w) + T(v_2 \otimes w) \\
T( v \otimes (w_1 + w_2)) &= T(v \otimes w_1) + T(v \otimes w_2) \\
T( (\alpha v) \otimes w ) &= T( \alpha ( v \otimes w) ) \\
T( v \otimes (\alpha w) ) &= T( \alpha ( v \otimes w) ) \\
\end{aligned}
$$

You can type \`$$<space>\` to create a math block.

***

Use [emoji cheat sheet](https://www.webfx.com/tools/emoji-cheat-sheet/) such as \`:+1:\` to add emoji[^1].

You may notice the emoji filter while inputting values, try to type \`:baby\` to see the list.

***

Diagrams is powered by [mermaid](https://mermaid-js.github.io/mermaid/#/).

You can type \` \`\`\`mermaid \` to add diagrams.

\`\`\`mermaid
graph TD;
EditorState-->EditorView;
EditorView-->DOMEvent;
DOMEvent-->Transaction;
Transaction-->EditorState;
\`\`\`

***

Have fun!

[^1]: We use [tweet emoji](https://twemoji.twitter.com) to make emoji can be viewed cross platforms.

`;

import type { Ctx } from "@milkdown/ctx";
import { editorViewCtx } from "@milkdown/core";
import { linkSchema } from "@milkdown/preset-commonmark";
import {
    linkTooltipAPI,
    linkTooltipState,
} from "@milkdown/components/link-tooltip";

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

const ControlBar = ({
    editorRef,
}: {
    editorRef: React.MutableRefObject<EditorRef | undefined>;
}) => {
    return (
        <Button onClick={() => editorRef.current?.action?.(insertLink)}>
            LINK
        </Button>
    );
};

export function Editor() {
    const [markdown, setMarkdown] = useLocalStorage(
        "markdown",
        defaultMarkdown,
    );

    const editorRef = useRef<EditorRef>();

    return (
        <MilkdownProvider>
            <ProsemirrorAdapterProvider>
                {markdown ? (
                    <>
                        <ControlBar editorRef={editorRef} />
                        <MarkdownEditor
                            initialValue={markdown}
                            updateMarkdown={setMarkdown}
                            ref={editorRef}
                        />
                    </>
                ) : null}
            </ProsemirrorAdapterProvider>
        </MilkdownProvider>
    );
}

export default Editor;
