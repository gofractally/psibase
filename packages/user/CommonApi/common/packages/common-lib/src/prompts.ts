// TODO: This could probably move to @psibase/prompt-lib instead
//       of living in @psibase/common-lib

import { isRedirectErrorObject } from "./messaging";
import { siblingUrl } from "./rpc";

const supervisorUrl = siblingUrl(null, "supervisor", null);

/** Query keys used to carry prompt state across Safari's partitioned iframe storage. */
export const PROMPT_QUERY = {
    app: "promptApp",
    name: "promptName",
    active: "activeApp",
    created: "created",
    context: "packedContext",
    inviteToken: "inviteToken",
} as const;

export interface PromptRedirectDetails {
    promptApp: string;
    promptName: string;
    activeApp: string;
    created?: string;
    packedContext?: string | null;
}

export const PROMPT_REDIRECT_PREFIX = "user_prompt_request";

export function parsePromptRedirectMessage(
    message: string,
): PromptRedirectDetails | null {
    if (!message.startsWith(PROMPT_REDIRECT_PREFIX)) {
        return null;
    }
    const payload = message.slice(PROMPT_REDIRECT_PREFIX.length);
    if (!payload.startsWith(":")) {
        return null;
    }
    try {
        const parsed = JSON.parse(payload.slice(1)) as PromptRedirectDetails;
        if (
            typeof parsed?.promptApp === "string" &&
            typeof parsed?.promptName === "string" &&
            typeof parsed?.activeApp === "string"
        ) {
            return parsed;
        }
    } catch {
        return null;
    }
    return null;
}

export function encodePromptRedirectMessage(
    details: PromptRedirectDetails,
): string {
    return `${PROMPT_REDIRECT_PREFIX}:${JSON.stringify(details)}`;
}

export function applyPromptDetailsToUrl(
    url: URL,
    details: PromptRedirectDetails,
): void {
    url.searchParams.set(PROMPT_QUERY.app, details.promptApp);
    url.searchParams.set(PROMPT_QUERY.name, details.promptName);
    url.searchParams.set(PROMPT_QUERY.active, details.activeApp);
    if (details.created) {
        url.searchParams.set(PROMPT_QUERY.created, details.created);
    }
    if (details.packedContext) {
        url.searchParams.set(PROMPT_QUERY.context, details.packedContext);
    }
}

export function promptDetailsFromSearch(
    search: string,
): PromptRedirectDetails | null {
    const params = new URLSearchParams(search);
    const promptApp = params.get(PROMPT_QUERY.app);
    const promptName = params.get(PROMPT_QUERY.name);
    const activeApp = params.get(PROMPT_QUERY.active);
    if (!promptApp || !promptName || !activeApp) {
        return null;
    }
    return {
        promptApp,
        promptName,
        activeApp,
        created: params.get(PROMPT_QUERY.created) || "",
        packedContext: params.get(PROMPT_QUERY.context),
    };
}

/**
 * Extracts common functionality needed by the developer of a plugin prompt UI.
 */
export const prompt = {
    /**
     * Call this when the user has finished interacting with your prompt.
     * It will redirect the user back to the app from which they came.
     */
    finished(): void {
        window.parent.postMessage("finished", supervisorUrl);
    },
};

/**
 * Used by root app UIs to automatically facilitate redirecting the
 * user to a prompt UI when triggered by a plugin.
 *
 * The caller may specify a `returnPath`, which is used as the destination to
 * which the user is returned when they are finished with the prompt.
 * @param {unknown} e - The error or event object.
 * @param {string} returnPath - The path to return the user to after the prompt (e.g. "/").
 */
export const handlePluginUserPrompt = async (
    e: unknown,
    returnPath: string,
) => {
    if (isRedirectErrorObject(e)) {
        if (e.message.includes("user_prompt_request")) {
            const url = new URL(siblingUrl(null, "supervisor", "/prompt.html"));
            url.searchParams.set("returnPath", returnPath.toString());
            const details = parsePromptRedirectMessage(e.message);
            if (details) {
                applyPromptDetailsToUrl(url, details);
            }
            const pageParams = new URLSearchParams(window.location.search);
            const inviteToken =
                pageParams.get(PROMPT_QUERY.inviteToken) ||
                pageParams.get("token");
            if (inviteToken) {
                url.searchParams.set(PROMPT_QUERY.inviteToken, inviteToken);
            }
            window.location.href = url.toString();
        }
    }
};
