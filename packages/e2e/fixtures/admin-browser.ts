import {
    type Browser,
    type BrowserContext,
    type Page,
} from "@playwright/test";
import { getRoutableIPv4 } from "../lib/routable-address";
import {
    expect,
    test as psinodeTest,
    type PsinodeNode,
} from "./psinode";

export type ConsoleErrorCollector = {
    readonly entries: string[];
    assertEmpty: () => void;
};

export type CollectedPage = {
    page: Page;
    context: BrowserContext;
    errors: ConsoleErrorCollector;
};

export type AdminPage = CollectedPage;

function attachCollector(context: BrowserContext): ConsoleErrorCollector {
    const entries: string[] = [];

    const onPage = (page: Page) => {
        page.on("console", (msg) => {
            if (msg.type() === "error") {
                entries.push(`console.error: ${msg.text()}`);
            }
        });
        page.on("pageerror", (error) => {
            entries.push(`pageerror: ${error.message}`);
        });
        page.on("requestfailed", (request) => {
            const errorText = request.failure()?.errorText ?? "unknown";
            // A request the page itself cancelled is not a failure. Leaving a
            // route unmounts its react-query observers, which abort whatever
            // poll is in flight, so any test that navigates would otherwise
            // record entries for working behavior. Network-level failures,
            // including a CORS-blocked request, report ERR_FAILED instead.
            if (errorText === "net::ERR_ABORTED") {
                return;
            }
            entries.push(`requestfailed: ${request.url()} (${errorText})`);
        });
    };

    context.on("page", onPage);
    for (const page of context.pages()) {
        onPage(page);
    }

    return {
        get entries() {
            return entries;
        },
        assertEmpty() {
            expect(entries, entries.join("\n")).toEqual([]);
        },
    };
}

async function openCollectedPage(
    browser: Browser,
    opened: BrowserContext[],
    contextOptions?: Parameters<Browser["newContext"]>[0],
): Promise<CollectedPage> {
    const context = await browser.newContext(contextOptions);
    const errors = attachCollector(context);
    const page = await context.newPage();
    opened.push(context);
    return { page, context, errors };
}

type AdminBrowserFixtures = {
    browser: Browser;
    openAdmin: (node: PsinodeNode) => Promise<AdminPage>;
};

export const test = psinodeTest.extend<AdminBrowserFixtures>({
    browser: async ({ playwright }, use) => {
        const ip = getRoutableIPv4();
        const browser = await playwright.chromium.launch({
            args: [`--host-resolver-rules=MAP *.psibase.localhost ${ip}`],
        });
        await use(browser);
        await browser.close();
    },

    openAdmin: async ({ browser }, use) => {
        const opened: BrowserContext[] = [];

        await use(async (node: PsinodeNode) => {
            // httpCredentials alone only answers WWW-Authenticate challenges. A
            // cross-origin 401 from x-peers has no ACAO, so Chromium hides it
            // from the page and never completes the challenge. Attach Basic on
            // every request so sibling-subdomain fetches authenticate without
            // that round trip.
            const authorization =
                "Basic " +
                Buffer.from(`${node.username}:${node.password}`).toString(
                    "base64",
                );
            return openCollectedPage(browser, opened, {
                httpCredentials: {
                    username: node.username,
                    password: node.password,
                },
                extraHTTPHeaders: { Authorization: authorization },
            });
        });

        for (const context of opened) {
            await context.close();
        }
    },
});

export { expect } from "./psinode";
export type { PsinodeNode } from "./psinode";
