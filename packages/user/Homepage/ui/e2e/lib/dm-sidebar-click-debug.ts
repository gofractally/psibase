import { expect, type Page } from "@playwright/test";

import {
    type ChatSelectionState,
    readChatSelectionState,
} from "./chat-ui";

export type SelectionSnapshot = ChatSelectionState & {
    ts: number;
    href: string;
};

export type DmClickScenarioId =
    | "group-deep-link"
    | "parked-no-realtime"
    | "home-nav"
    | "openDmThread-group-deep-link"
    | "openDmThread-parked-no-realtime"
    | "openDmThread-home-nav"
    | "accumulated-churn-openDmThread"
    | "post-pending-openDmThread";

const LOG_PREFIX = "[dm-click-debug]";

export type SidebarInventory = {
    conversationListSummary: {
        total: number;
        dm: number;
        group: number;
        objectiveSpacesCount: number;
    } | null;
    dmRowVisible: boolean;
    contactsRowVisible: boolean;
    dmSectionEmptyHint: boolean;
};

/** Log why Direct Messages row may be missing (objective spaces vs DOM). */
export async function logSidebarInventory(
    page: Page,
    peerAccount: string,
    label: string,
): Promise<SidebarInventory> {
    const state = await page
        .evaluate(() => {
            const churn = (
                window as unknown as {
                    __chatChurnState?: () => {
                        conversationListSummary?: SidebarInventory["conversationListSummary"];
                    };
                }
            ).__chatChurnState?.();
            return churn?.conversationListSummary ?? null;
        })
        .catch(() => null);

    const dmRow = page
        .getByRole("button", { name: dmRowNamePattern(peerAccount) })
        .locator("visible=true")
        .last();
    const contactsToggle = page
        .getByRole("button", { name: "Contacts", exact: true })
        .locator("visible=true")
        .last();
    const contactButton = contactsToggle
        .locator("xpath=following-sibling::div[1]")
        .getByRole("button")
        .filter({ hasText: peerAccount })
        .first();

    const inventory: SidebarInventory = {
        conversationListSummary: state,
        dmRowVisible: await dmRow.isVisible().catch(() => false),
        contactsRowVisible: await contactButton.isVisible().catch(() => false),
        dmSectionEmptyHint: await page
            .getByText("None — expand Contacts to start a new DM.")
            .locator("visible=true")
            .first()
            .isVisible()
            .catch(() => false),
    };

    const dmButtonLabels = await page
        .evaluate(() => {
            const toggle = [...document.querySelectorAll("button")].find(
                (b) => b.textContent?.trim() === "Direct Messages",
            );
            if (!toggle) return { dmSectionExpanded: null, labels: [] as string[] };
            const expanded = toggle.getAttribute("aria-expanded") === "true";
            const container = toggle.parentElement;
            const rows = container
                ? [...container.querySelectorAll("button[aria-label]")].filter(
                      (b) => b !== toggle,
                  )
                : [];
            return {
                dmSectionExpanded: expanded,
                labels: rows.map((b) => b.getAttribute("aria-label") ?? ""),
            };
        })
        .catch(() => null);

    console.log(
        `${LOG_PREFIX} sidebar-inventory ${label} ${JSON.stringify(inventory)} dmButtons=${JSON.stringify(dmButtonLabels)}`,
    );
    return inventory;
}

function dmRowNamePattern(peerAccount: string): RegExp {
    const escaped = peerAccount.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\(${escaped}\\)|^${escaped}(?:$|[,])`, "i");
}

/** Snapshot URL + __chatChurnState selection for structured logs. */
export async function snapshotSelection(
    page: Page,
): Promise<SelectionSnapshot> {
    const state = await readChatSelectionState(page);
    return { ...state, ts: Date.now(), href: page.url() };
}

export function logSelection(label: string, snap: SelectionSnapshot): void {
    console.log(
        `${LOG_PREFIX} ${label} ${JSON.stringify({
            href: snap.href,
            urlSpaceId: snap.urlSpaceId,
            selectedConversationId: snap.selectedConversationId,
            selectedConversationKind: snap.selectedConversationKind,
            composePendingDmPeer: snap.composePendingDmPeer,
            pendingDmMember: snap.pendingDmMember,
            threadHeader: snap.threadHeader,
        })}`,
    );
}

/** True when the app reports an active DM compose surface for `peerAccount`. */
export function isDmWithPeer(
    state: ChatSelectionState,
    peerAccount: string,
    groupSpaceId: string,
): boolean {
    if (state.composePendingDmPeer === peerAccount) return true;
    if (state.pendingDmMember === peerAccount) return true;
    if (
        state.selectedConversationKind === "dm" &&
        (state.threadHeader?.includes(peerAccount) ?? false)
    ) {
        return true;
    }
    if (
        groupSpaceId &&
        state.selectedConversationId &&
        state.selectedConversationId !== groupSpaceId
    ) {
        return true;
    }
    return false;
}

async function ensureSidebarSectionExpanded(
    page: Page,
    sectionName: string,
): Promise<void> {
    const toggle = page
        .getByRole("button", { name: sectionName, exact: true })
        .locator("visible=true")
        .last();
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
        await toggle.click();
    }
}

/**
 * Raw sidebar click — Direct Messages row first, then Contacts fallback.
 * No URL sync, no composer waits (mirrors production click path).
 */
export async function clickDmSidebarTarget(
    page: Page,
    peerAccount: string,
): Promise<{ path: "dm-row" | "contacts-row" }> {
    await ensureSidebarSectionExpanded(page, "Direct Messages");
    const dmRow = page
        .getByRole("button", { name: dmRowNamePattern(peerAccount) })
        .locator("visible=true")
        .last();
    const dmVisible = await dmRow.isVisible().catch(() => false);
    console.log(
        `${LOG_PREFIX} sidebar dm-row visible=${dmVisible} for ${peerAccount}`,
    );
    if (dmVisible) {
        await dmRow.click();
        return { path: "dm-row" };
    }

    await ensureSidebarSectionExpanded(page, "Contacts");
    console.log(`${LOG_PREFIX} sidebar falling back to Contacts row`);
    const contactsToggle = page
        .getByRole("button", { name: "Contacts", exact: true })
        .locator("visible=true")
        .last();
    const contactButton = contactsToggle
        .locator("xpath=following-sibling::div[1]")
        .getByRole("button")
        .filter({ hasText: peerAccount })
        .first();
    await expect(contactButton).toBeVisible({ timeout: 30_000 });
    await contactButton.click();
    return { path: "contacts-row" };
}

export async function recordSelectionTimeline(
    page: Page,
    durationMs: number,
    intervalMs = 250,
): Promise<SelectionSnapshot[]> {
    const snaps: SelectionSnapshot[] = [];
    const end = Date.now() + durationMs;
    while (Date.now() < end) {
        snaps.push(await snapshotSelection(page));
        await page.waitForTimeout(intervalMs);
    }
    return snaps;
}

export type OscillationReport = {
    oscillated: boolean;
    summary: string;
    transitions: string[];
};

/** Detect group ↔ DM selection flips during a post-click timeline. */
export function analyzeSelectionOscillation(
    snaps: readonly SelectionSnapshot[],
    groupSpaceId: string,
): OscillationReport {
    const transitions: string[] = [];
    let prev: string | null = null;
    for (const snap of snaps) {
        const kind =
            snap.selectedConversationKind ??
            (snap.selectedConversationId === groupSpaceId ? "group" : "other");
        const key = `${kind}:${snap.urlSpaceId ?? "no-url-space"}`;
        if (prev !== null && key !== prev) {
            transitions.push(`${prev} -> ${key}`);
        }
        prev = key;
    }
    const kinds = new Set(
        snaps.map((s) => s.selectedConversationKind ?? "unknown"),
    );
    const oscillated =
        transitions.length > 0 &&
        kinds.has("group") &&
        (kinds.has("dm") || kinds.has("null"));
    const summary = oscillated
        ? `selection oscillated (${transitions.length} transitions)`
        : transitions.length > 0
          ? `stable after ${transitions.length} transition(s)`
          : "stable (no transitions)";
    return { oscillated, summary, transitions };
}

export function logTimeline(
    scenario: string,
    snaps: readonly SelectionSnapshot[],
): void {
    console.log(
        `${LOG_PREFIX} timeline ${scenario} (${snaps.length} samples):`,
    );
    for (const snap of snaps) {
        console.log(
            `${LOG_PREFIX}   t+${snap.ts - snaps[0]!.ts}ms kind=${snap.selectedConversationKind} urlSpace=${snap.urlSpaceId?.slice(0, 24) ?? "null"} selected=${snap.selectedConversationId?.slice(0, 24) ?? "null"} header=${snap.threadHeader ?? "null"}`,
        );
    }
}

export type DmClickAttemptResult = {
    scenario: string;
    clickPath: "dm-row" | "contacts-row";
    before: SelectionSnapshot;
    afterClick: SelectionSnapshot;
    timeline: SelectionSnapshot[];
    oscillation: OscillationReport;
    dmActive: boolean;
};

/**
 * Click a DM sidebar target and record selection/URL behavior for triage.
 * Fails with a detailed log when DM selection does not stick.
 */
export async function runDmClickScenario(
    page: Page,
    scenario: DmClickScenarioId | string,
    peerAccount: string,
    groupSpaceId: string,
    options?: {
        settleMs?: number;
        assertMs?: number;
    },
): Promise<DmClickAttemptResult> {
    const settleMs = options?.settleMs ?? 5_000;
    const assertMs = options?.assertMs ?? 15_000;

    console.log(`\n${LOG_PREFIX} ===== scenario: ${scenario} =====`);
    const before = await snapshotSelection(page);
    logSelection(`${scenario}:before`, before);
    await logSidebarInventory(page, peerAccount, `${scenario}:before`);

    const { path: clickPath } = await clickDmSidebarTarget(page, peerAccount);
    console.log(`${LOG_PREFIX} ${scenario}:click path=${clickPath}`);

    const afterClick = await snapshotSelection(page);
    logSelection(`${scenario}:after-click`, afterClick);

    const timeline = await recordSelectionTimeline(page, settleMs);
    logTimeline(scenario, timeline);

    const oscillation = analyzeSelectionOscillation(timeline, groupSpaceId);
    console.log(
        `${LOG_PREFIX} ${scenario}:oscillation ${JSON.stringify(oscillation)}`,
    );

    const finalSnap = timeline.at(-1) ?? afterClick;
    logSelection(`${scenario}:final`, finalSnap);

    let dmActive = false;
    try {
        await expect
            .poll(
                async () => {
                    const snap = await snapshotSelection(page);
                    return isDmWithPeer(snap, peerAccount, groupSpaceId);
                },
                { timeout: assertMs, intervals: [200, 500, 1000] },
            )
            .toBe(true);
        dmActive = true;
    } catch {
        dmActive = isDmWithPeer(finalSnap, peerAccount, groupSpaceId);
    }

    const result: DmClickAttemptResult = {
        scenario,
        clickPath,
        before,
        afterClick,
        timeline,
        oscillation,
        dmActive,
    };

    if (!dmActive || oscillation.oscillated) {
        console.log(
            `${LOG_PREFIX} ${scenario}:FAIL dmActive=${dmActive} ${oscillation.summary}`,
        );
        throw new Error(
            `[dm-click-debug] scenario "${scenario}" failed: dmActive=${dmActive}, ${oscillation.summary}, clickPath=${clickPath}, finalUrl=${finalSnap.href}`,
        );
    }

    console.log(`${LOG_PREFIX} ${scenario}:PASS`);
    return result;
}

/** Same instrumentation as runDmClickScenario but uses production openDmThread. */
export async function runOpenDmThreadScenario(
    page: Page,
    scenario: string,
    peerAccount: string,
    groupSpaceId: string,
    openDmThread: (
        page: Page,
        baseUrl: string,
        peer: string,
        opts?: { gotoTimeout?: number; groupSpaceId?: string },
    ) => Promise<void>,
    baseUrl: string,
    options?: {
        settleMs?: number;
        assertMs?: number;
        gotoTimeout?: number;
    },
): Promise<DmClickAttemptResult> {
    const settleMs = options?.settleMs ?? 5_000;
    const assertMs = options?.assertMs ?? 45_000;
    const gotoTimeout = options?.gotoTimeout ?? 45_000;

    console.log(`\n${LOG_PREFIX} ===== scenario: ${scenario} (openDmThread) =====`);
    const before = await snapshotSelection(page);
    logSelection(`${scenario}:before`, before);
    await logSidebarInventory(page, peerAccount, `${scenario}:before`);

    await openDmThread(page, baseUrl, peerAccount, {
        groupSpaceId,
        gotoTimeout,
    });
    console.log(`${LOG_PREFIX} ${scenario}:openDmThread returned`);

    const afterClick = await snapshotSelection(page);
    logSelection(`${scenario}:after-open`, afterClick);

    const timeline = await recordSelectionTimeline(page, settleMs);
    logTimeline(scenario, timeline);

    const oscillation = analyzeSelectionOscillation(timeline, groupSpaceId);
    console.log(
        `${LOG_PREFIX} ${scenario}:oscillation ${JSON.stringify(oscillation)}`,
    );

    const finalSnap = timeline.at(-1) ?? afterClick;
    logSelection(`${scenario}:final`, finalSnap);

    let dmActive = false;
    try {
        await expect
            .poll(
                async () => {
                    const snap = await snapshotSelection(page);
                    return isDmWithPeer(snap, peerAccount, groupSpaceId);
                },
                { timeout: assertMs, intervals: [200, 500, 1000] },
            )
            .toBe(true);
        dmActive = true;
    } catch {
        dmActive = isDmWithPeer(finalSnap, peerAccount, groupSpaceId);
    }

    const result: DmClickAttemptResult = {
        scenario,
        clickPath: "contacts-row",
        before,
        afterClick,
        timeline,
        oscillation,
        dmActive,
    };

    if (!dmActive || oscillation.oscillated) {
        console.log(
            `${LOG_PREFIX} ${scenario}:FAIL dmActive=${dmActive} ${oscillation.summary}`,
        );
        throw new Error(
            `[dm-click-debug] scenario "${scenario}" failed: dmActive=${dmActive}, ${oscillation.summary}, finalUrl=${finalSnap.href}`,
        );
    }

    console.log(`${LOG_PREFIX} ${scenario}:PASS`);
    return result;
}

export function parseDmClickScenarios(): Set<DmClickScenarioId> | "all" {
    const raw = process.env.PSIBASE_E2E_DM_CLICK_SCENARIO?.trim();
    if (!raw || raw === "all") return "all";
    const ids = raw.split(",").map((s) => s.trim()) as DmClickScenarioId[];
    return new Set(ids);
}

export function shouldRunScenario(
    id: DmClickScenarioId,
    filter: Set<DmClickScenarioId> | "all",
): boolean {
    return filter === "all" || filter.has(id);
}
