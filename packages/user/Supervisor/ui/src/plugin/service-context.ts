import { postGraphQLGetJson, siblingUrl } from "@psibase/common-lib/rpc";

import { ServiceMap } from "../component-loading/loader";
import { HostInterface } from "../host-interface";
import { Plugin } from "./plugin";

export interface LoadedPlugin {
    plugin: Plugin;
    new: boolean;
}

type ServiceUiDeps = {
    data: {
        depsFor: {
            deps: {
                name: string;
                service: string;
            }[];
        };
    };
};

async function getServiceMap(service: string): Promise<ServiceMap | null> {
    const url = siblingUrl(null, "dyn-ld", `/graphql`);
    const query = `query { depsFor(service: "${service}") { deps { name service }}}`;
    const result = await postGraphQLGetJson<ServiceUiDeps>(url, query);
    if (result.data.depsFor) {
        let map = new Object() as ServiceMap;
        for (const { name, service } of result.data.depsFor.deps) {
            map[name] = service;
        }
        return map;
    } else {
        return null;
    }
}

// A service can serve multiple plugins, but each plugin does not have a meaninful identity
//   outside of the service that serves the plugin. This class is given a single host interface
//   from the supervisor, and facilitates loading that interface into each plugin served by the
//   service.
export class ServiceContext {
    private service: string;
    private plugins: Plugin[] = [];
    private hostInterface: HostInterface;
    private services: Promise<ServiceMap | null>;

    constructor(service: string, hostInterface: HostInterface) {
        this.service = service;
        this.hostInterface = hostInterface;
        this.services = getServiceMap(service);
    }

    loadPlugin(plugin: string): LoadedPlugin {
        let p: Plugin | undefined = this.plugins.find(
            (p) => p.id.service == this.service && p.id.plugin == plugin,
        );
        if (p) {
            return { plugin: p, new: false };
        }

        p = new Plugin(
            { service: this.service, plugin },
            this.hostInterface,
            this.services,
        );
        this.plugins.push(p);
        return { plugin: p, new: true };
    }

    hasLoaded(plugin: Plugin): boolean {
        return this.plugins.some(
            (p) =>
                p.id.plugin === plugin.id.plugin &&
                p.id.service === plugin.id.service,
        );
    }
}
