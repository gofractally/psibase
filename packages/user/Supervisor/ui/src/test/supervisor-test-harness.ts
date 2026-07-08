import { QualifiedPluginId } from "@psibase/common-lib";
import { isFunctionCallResponse } from "@psibase/common-lib/messaging";
import { vi } from "vitest";

import { Plugins } from "@/plugin/plugins";
import { Supervisor } from "@/supervisor";

import {
    createAppPlugin,
    createTransactPlugin,
    TestPlugin,
} from "./test-plugin";

const MOCK_APP: QualifiedPluginId = { service: "mock", plugin: "plugin" };
const TRANSACT: QualifiedPluginId = { service: "transact", plugin: "plugin" };

export const TEST_ORIGIN = "http://network.psibase.localhost:8080";

function injectPlugin(plugins: Plugins, plugin: TestPlugin): void {
    const getServiceContext = (
        plugins as unknown as {
            getServiceContext: (service: string) => { plugins: TestPlugin[] };
        }
    ).getServiceContext.bind(plugins);
    const ctx = getServiceContext(plugin.id.service);
    const exists = ctx.plugins.some(
        (existing) =>
            existing.id.service === plugin.id.service &&
            existing.id.plugin === plugin.id.plugin,
    );
    if (!exists) {
        ctx.plugins.push(plugin);
    }
}

function seedTestPlugins(plugins: Plugins): void {
    injectPlugin(plugins, createAppPlugin(MOCK_APP));
    injectPlugin(plugins, createTransactPlugin(TRANSACT));
}

export function createTestSupervisor(): Supervisor {
    const supervisor = new Supervisor();
    vi.spyOn(supervisor as unknown as { doPreload: () => Promise<void> }, "doPreload").mockImplementation(
        async function (this: Supervisor) {
            seedTestPlugins((this as unknown as { plugins: Plugins }).plugins);
        },
    );
    return supervisor;
}

export function mockParentReplies(): Map<string, unknown> {
    const replies = new Map<string, unknown>();
    vi.spyOn(window.parent, "postMessage").mockImplementation((data) => {
        if (isFunctionCallResponse(data)) {
            replies.set(data.id, data.result);
        }
    });
    return replies;
}

export function mockAppCallArgs() {
    return {
        service: MOCK_APP.service,
        plugin: MOCK_APP.plugin,
        intf: "api",
        method: "ping",
        params: [] as unknown[],
    };
}

export function mockAppPluginId(): QualifiedPluginId {
    return { ...MOCK_APP };
}
