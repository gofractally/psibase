import { Terminal } from "lucide-react";

import { siblingUrl } from "@psibase/common-lib";

export const Developers = () => {
    return (
        <a
            href={siblingUrl(null, "workshop", null, false)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 p-2 text-sm text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
        >
            <Terminal className="size-4" />
            <span>Developers</span>
        </a>
    );
};
