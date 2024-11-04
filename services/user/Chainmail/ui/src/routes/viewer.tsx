import { MilkdownProvider } from "@milkdown/react";
import { ProsemirrorAdapterProvider } from "@prosemirror-adapter/react";

import { useLocalStorage } from "@hooks";

import { MarkdownEditor } from "@components";

export function Viewer() {
    const [markdown, setMarkdown] = useLocalStorage("markdown", "");

    return (
        <MilkdownProvider>
            <ProsemirrorAdapterProvider>
                {markdown ? (
                    <MarkdownEditor
                        initialValue={markdown}
                        updateMarkdown={setMarkdown}
                        readOnly
                    />
                ) : null}
            </ProsemirrorAdapterProvider>
        </MilkdownProvider>
    );
}

export default Viewer;
