import { MilkdownProvider } from "@milkdown/react";

import { useLocalStorage } from "@hooks";

import { MarkdownEditor } from "@components";

export function Viewer() {
    const [markdown, setMarkdown] = useLocalStorage("markdown", "");

    return (
        <MilkdownProvider>
            {markdown ? (
                <MarkdownEditor
                    initialValue={markdown}
                    updateMarkdown={setMarkdown}
                    readOnly
                />
            ) : null}
        </MilkdownProvider>
    );
}

export default Viewer;
