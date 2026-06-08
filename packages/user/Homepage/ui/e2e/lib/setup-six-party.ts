import type { Browser, BrowserContext, Page } from "@playwright/test";

import {
    createAccountViaInviteUrl,
    createInviteUrl,
    loginProducerViaUi,
    PRODUCER_ACCOUNT,
    uniqueE2eAccountName,
    type TestAccount,
} from "./auth-ui";
import { ensureContact } from "./chat-ui";
import { attachDiagnostics } from "./diagnostics";

export type SixPartyNames = {
    alice: string;
    bob: string;
    carol: string;
    dave: string;
    eve: string;
    frank: string;
};

export type SixPartyMemberKey = "bob" | "carol" | "dave" | "eve" | "frank";

export type SixPartySetup = {
    accounts: {
        alice: TestAccount;
        bob: TestAccount;
        carol: TestAccount;
        dave: TestAccount;
        eve: TestAccount;
        frank: TestAccount;
    };
    pages: Record<SixPartyMemberKey, Page>;
    /** Every participant name except `self`. */
    peerNamesExcept: (self: string) => string[];
    cleanup: () => Promise<void>;
};

function resolveSixPartyNames(namesOrPrefix: SixPartyNames | string): SixPartyNames {
    if (typeof namesOrPrefix !== "string") {
        return namesOrPrefix;
    }
    const prefix = namesOrPrefix;
    return {
        alice: uniqueE2eAccountName(`${prefix}a`),
        bob: uniqueE2eAccountName(`${prefix}b`),
        carol: uniqueE2eAccountName(`${prefix}c`),
        dave: uniqueE2eAccountName(`${prefix}d`),
        eve: uniqueE2eAccountName(`${prefix}e`),
        frank: uniqueE2eAccountName(`${prefix}f`),
    };
}

/** Shared 6-party account + contact graph setup for group chat e2e specs. */
export async function setupSixPartyAccounts(
    chain: { baseUrl: string },
    alicePage: Page,
    browser: Browser,
    namesOrPrefix: SixPartyNames | string,
): Promise<SixPartySetup> {
    const names = resolveSixPartyNames(namesOrPrefix);

    await loginProducerViaUi(alicePage, PRODUCER_ACCOUNT, chain.baseUrl);
    const invites: string[] = [];
    for (let i = 0; i < 6; i++) {
        invites.push(await createInviteUrl(alicePage, PRODUCER_ACCOUNT));
    }

    const aliceAccount = await createAccountViaInviteUrl(
        alicePage,
        invites[0]!,
        names.alice,
    );

    const memberKeys: SixPartyMemberKey[] = ["bob", "carol", "dave", "eve", "frank"];
    const memberNames = memberKeys.map((key) => names[key]);
    const contexts: BrowserContext[] = [];
    const pages: Record<SixPartyMemberKey, Page> = {} as Record<
        SixPartyMemberKey,
        Page
    >;
    const accounts: SixPartySetup["accounts"] = {
        alice: aliceAccount,
        bob: {} as TestAccount,
        carol: {} as TestAccount,
        dave: {} as TestAccount,
        eve: {} as TestAccount,
        frank: {} as TestAccount,
    };

    for (let i = 0; i < memberKeys.length; i++) {
        const key = memberKeys[i]!;
        const context = await browser.newContext();
        contexts.push(context);
        const page = await context.newPage();
        attachDiagnostics(page, key);
        pages[key] = page;
        accounts[key] = await createAccountViaInviteUrl(
            page,
            invites[i + 1]!,
            memberNames[i]!,
        );
    }

    const allNames = [names.alice, ...memberNames];
    for (const page of [alicePage, ...Object.values(pages)]) {
        const selfName =
            page === alicePage
                ? names.alice
                : memberKeys.find((key) => pages[key] === page)!;
        const selfAccount =
            page === alicePage ? names.alice : names[selfName as SixPartyMemberKey];
        for (const peer of allNames) {
            if (peer !== selfAccount) {
                await ensureContact(page, chain.baseUrl, peer);
            }
        }
    }

    return {
        accounts,
        pages,
        peerNamesExcept(self: string) {
            return allNames.filter((name) => name !== self);
        },
        async cleanup() {
            await Promise.all(contexts.map((ctx) => ctx.close().catch(() => {})));
        },
    };
}
