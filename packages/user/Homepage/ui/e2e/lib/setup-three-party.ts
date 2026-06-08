import type { Browser, Page } from "@playwright/test";

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

export type ThreePartyNames = {
    alice: string;
    bob: string;
    carol: string;
};

export type ThreePartySetup = {
    aliceAccount: TestAccount;
    bobAccount: TestAccount;
    carolAccount: TestAccount;
    bobPage: Page;
    carolPage: Page;
    cleanup: () => Promise<void>;
};

/** Unique alice/bob/carol names for one spec (shared chain, serial workers). */
export function uniqueThreePartyNames(testPrefix: string): ThreePartyNames {
    return {
        alice: uniqueE2eAccountName(`${testPrefix}a`),
        bob: uniqueE2eAccountName(`${testPrefix}b`),
        carol: uniqueE2eAccountName(`${testPrefix}c`),
    };
}

function resolveThreePartyNames(
    namesOrPrefix: ThreePartyNames | string,
): ThreePartyNames {
    return typeof namesOrPrefix === "string"
        ? uniqueThreePartyNames(namesOrPrefix)
        : namesOrPrefix;
}

/** Shared 3-party account + contact graph setup for group chat e2e specs. */
export async function setupThreePartyAccounts(
    chain: { baseUrl: string },
    alicePage: Page,
    browser: Browser,
    namesOrPrefix: ThreePartyNames | string,
): Promise<ThreePartySetup> {
    const names = resolveThreePartyNames(namesOrPrefix);

    await loginProducerViaUi(alicePage, PRODUCER_ACCOUNT, chain.baseUrl);
    const aliceInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);
    const bobInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);
    const carolInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);

    const aliceAccount = await createAccountViaInviteUrl(
        alicePage,
        aliceInvite,
        names.alice,
    );

    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    attachDiagnostics(bobPage, "bob");
    const carolContext = await browser.newContext();
    const carolPage = await carolContext.newPage();
    attachDiagnostics(carolPage, "carol");

    const bobAccount = await createAccountViaInviteUrl(
        bobPage,
        bobInvite,
        names.bob,
    );
    const carolAccount = await createAccountViaInviteUrl(
        carolPage,
        carolInvite,
        names.carol,
    );

    for (const [page, peer] of [
        [alicePage, bobAccount.name],
        [alicePage, carolAccount.name],
        [bobPage, aliceAccount.name],
        [bobPage, carolAccount.name],
        [carolPage, aliceAccount.name],
        [carolPage, bobAccount.name],
    ] as const) {
        await ensureContact(page, chain.baseUrl, peer);
    }

    return {
        aliceAccount,
        bobAccount,
        carolAccount,
        bobPage,
        carolPage,
        async cleanup() {
            await bobContext.close().catch(() => {});
            await carolContext.close().catch(() => {});
        },
    };
}
