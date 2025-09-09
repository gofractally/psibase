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
 * @param {string} returnPath - The path to return the user to after the prompt (e.g. "/").
 */
export const handlePluginUserPrompt = async (e: unknown, returnPath: string) => {
    if (isRedirectErrorObject(e)) {
        if (
            e.message.includes("user_prompt_request")
        ) {
            const thisService = await (await fetch("/common/thisservice")).json();
            const baseUrlHasSibling = (thisService === "homepage") ? false : true;

            const url = new URL(siblingUrl(null, "supervisor", "/prompt.html", baseUrlHasSibling));
            url.searchParams.set("returnPath", returnPath.toString());
            window.location.href = url.toString();
        }
    }
};