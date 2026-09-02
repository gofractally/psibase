import { QualifiedPluginId } from "@psibase/common-lib";

import { PluginInvalid } from "@/plugin/errors";

export const CALL_SENTINEL = "mock-entry-ok";

export class TestPlugin {
    id: QualifiedPluginId;

    private pluginModule: Record<string, unknown> | undefined;

    private readonly compiledPlugin = {
        instantiate: async () => {
            await Promise.resolve();
            return { exports: {} };
        },
    };

    constructor(id: QualifiedPluginId, private readonly handlers: TestPluginHandlers) {
        this.id = id;
    }

    async instantiate(): Promise<void> {
        if (this.pluginModule) {
            return;
        }
        await this.compiledPlugin.instantiate();
        this.pluginModule = {};
    }

    dispose(): boolean {
        if (!this.pluginModule) {
            return false;
        }
        this.pluginModule = undefined;
        return true;
    }

    call(intf: string | undefined, method: string, _params: unknown[]): unknown {
        if (!this.pluginModule) {
            throw new PluginInvalid(this.id);
        }
        return this.handlers.call(intf, method);
    }

    resourceCall(): never {
        throw new Error("TestPlugin does not implement resourceCall");
    }

    getJson(): string {
        return "{}";
    }
}

export type TestPluginHandlers = {
    call: (intf: string | undefined, method: string) => unknown;
};

export function createAppPlugin(id: QualifiedPluginId): TestPlugin {
    return new TestPlugin(id, {
        call: (intf, method) => {
            if (intf === "api" && method === "ping") {
                return CALL_SENTINEL;
            }
            throw new Error(`Unexpected app call ${intf ?? ""}->${method}`);
        },
    });
}

export function createTransactPlugin(id: QualifiedPluginId): TestPlugin {
    return new TestPlugin(id, {
        call: (intf, method) => {
            if (intf === "admin" && (method === "start-tx" || method === "finish-tx")) {
                return null;
            }
            throw new Error(`Unexpected transact call ${intf ?? ""}->${method}`);
        },
    });
}
