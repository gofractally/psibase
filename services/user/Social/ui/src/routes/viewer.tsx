import { MilkdownProvider } from "@milkdown/react";

import { useLocalStorage } from "@hooks";

import { MilkdownEditorComponent } from "./editor";

export function Viewer() {
    const [markdown, setMarkdown] = useLocalStorage("markdown", "");

    return (
        <MilkdownProvider>
            {markdown ? (
                <MilkdownEditorComponent
                    initialValue={markdown}
                    updateMarkdown={setMarkdown}
                    readOnly
                />
            ) : null}
        </MilkdownProvider>
    );
}

export default Viewer;
