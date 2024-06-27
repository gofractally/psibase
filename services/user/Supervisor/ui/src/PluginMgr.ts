import { siblingUrl, QualifiedPluginId } from "@psibase/common-lib";

import { Plugin } from "./Plugin";

export class PluginMgr {
    private plugins: { [service: string]: Plugin[] } = {};

    private addPlugin(id: QualifiedPluginId): Plugin {
        const { service, plugin } = id;
        if (!this.plugins[service]) {
            this.plugins[service] = [];
        }
        const existing = this.plugins[service].find((p) => p.id === id);
        if (existing !== undefined) return existing;

        const p = new Plugin({ service, plugin });
        this.plugins[service].push(p);
        return p;
    }

    private hasOrigin(origin: string): boolean {
        return Object.entries(this.plugins)
            .map(([service, _]) => siblingUrl(null, service))
            .includes(origin);
    }

    get(id: QualifiedPluginId): Plugin {
        if (!this.plugins[id.service]) {
            return this.addPlugin(id);
        }

        const p = this.plugins[id.service].find((p) => p.id === id);
        if (p) {
            return p;
        }

        return this.addPlugin(id);
    }

    isMessageFromPlugin(message: MessageEvent): boolean {
        const originIsChild = this.hasOrigin(message.origin);
        const isTop = message.source == window.top;
        const isParent = message.source == window.parent;
        return originIsChild && !isTop && !isParent;
    }

    preloadPlugins(preloads: QualifiedPluginId[]) {
        preloads.forEach((p) => this.get(p));
    }
}
