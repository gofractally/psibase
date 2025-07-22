// TODO: This could probably move to @psibase/prompt-lib instead
//       of living in @psibase/common-lib

import { isRedirectErrorObject } from "./messaging";
import { siblingUrl } from "./rpc";

const supervisorUrl = siblingUrl(null, "supervisor", null, true);

/**
 * Extracts common functionality needed by the developer of a plugin prompt UI.
 */
export const prompt = {
  /**
   * Gets the contextId specified by your plugin when it triggered the prompt.
   * A contextId is often used to look up (within your plugin) additional information about
   * the context of this prompt.
   * @returns {string | null} The contextId or null if not present.
   */
  getContextId(): string | null {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get("context_id") || null;
  },

  /**
   * Call this when the user has finished interacting with your prompt.
   * It will redirect the user back to the app from which they came.
   */
  finished(): void {
      window.parent.postMessage('finished', supervisorUrl);
  }
};

/**
 * Used by root app UIs to automatically facilitate redirecting the
 * user to a prompt UI when triggered by a plugin.
 *
 * The caller may specify a `returnPath`, which is used as the destination to
 * which the user is returned when they are finished with the prompt.
 * @param {unknown} e - The error or event object.
 * @param {string} returnPath - The path to return the user to after the prompt.
 */
export const handlePluginUserPrompt = (e: unknown, returnPath: string) => {
    if (isRedirectErrorObject(e)) {
        if (
            e.message.includes(
                siblingUrl(null, "supervisor", null, true),
            )
        ) {
            const returnUrl = new URL(window.location.href);
            returnUrl.pathname = returnPath;

            const url = new URL(e.message);
            url.searchParams.set("returnUrl", returnUrl.toString());
            window.location.href = url.toString();
        }
    }
};