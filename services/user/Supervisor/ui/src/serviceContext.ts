import { Plugin } from "./plugin/plugin";
import { HostInterface } from "./hostInterface";

export interface LoadedPlugin {
    plugin: Plugin;
    new: boolean;
}

// A service can serve multiple plugins, but each plugin does not have a meaninful identity
//   outside of the service that serves the plugin. This class is given a single host interface
//   from the supervisor, and facilitates loading that interface into each plugin served by the
//   service.
export class ServiceContext {
    private service: string;
    private plugins: Plugin[] = [];
    private hostInterface: HostInterface;

    constructor(service: string, hostInterface: HostInterface) {
        this.service = service;
        this.hostInterface = hostInterface;
    }

    loadPlugin(plugin: string): LoadedPlugin {
        let p: Plugin | undefined = this.plugins.find(
            (p) => p.id.service == this.service && p.id.plugin == plugin,
        );
        if (p) {
            return { plugin: p, new: false };
        }

        p = new Plugin({ service: this.service, plugin }, this.hostInterface);
        this.plugins.push(p);
        return { plugin: p, new: true };
    }

    hasLoaded(plugin: Plugin): boolean {
        return !!this.plugins.find(
            (p) =>
                p.id.plugin === plugin.id.plugin &&
                p.id.service === plugin.id.service,
        );
    }
}
