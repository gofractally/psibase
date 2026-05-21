import { existsSync, readFileSync } from "node:fs";

import { test as base, type BrowserContext, type Page } from "@playwright/test";

import { chainStateFile, registerE2eChainCleanupHandlers } from "../lib/chain-boot";

type ChainInfo = {
    host: string;
    port: number;
    baseUrl: string;
};

function readChainInfo(): ChainInfo {
    const file = chainStateFile();
    if (!existsSync(file)) {
        throw new Error(
            `e2e chain state file not found at ${file}; did global-setup run?`,
        );
    }
    const raw = JSON.parse(readFileSync(file, "utf8")) as ChainInfo & {
        external: boolean;
    };
    return { host: raw.host, port: raw.port, baseUrl: raw.baseUrl };
}

export type ChatPersona = {
    name: "alice" | "bob";
    page: Page;
    context: BrowserContext;
};

/**
 * Two browser contexts on the same chain: one for alice, one for bob.
 * The actual login flow is intentionally left for spec-level helpers; this
 * fixture stops at "two pages on the homepage with isolated storage", which
 * is the contract every chat spec needs.
 */
export const test = base.extend<{
    chain: ChainInfo;
    aliceContext: BrowserContext;
    bobContext: BrowserContext;
    alicePage: Page;
    bobPage: Page;
}>({
    chain: async ({}, use) => {
        registerE2eChainCleanupHandlers();
        await use(readChainInfo());
    },
    aliceContext: async ({ browser }, use) => {
        const ctx = await browser.newContext({ storageState: undefined });
        await use(ctx);
        await ctx.close();
    },
    bobContext: async ({ browser }, use) => {
        const ctx = await browser.newContext({ storageState: undefined });
        await use(ctx);
        await ctx.close();
    },
    alicePage: async ({ aliceContext }, use) => {
        const page = await aliceContext.newPage();
        await use(page);
    },
    bobPage: async ({ bobContext }, use) => {
        const page = await bobContext.newPage();
        await use(page);
    },
});

export const expect = test.expect;
