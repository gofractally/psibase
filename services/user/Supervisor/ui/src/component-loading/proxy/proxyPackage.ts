import { Code, FilePath, ImportDetails, PkgId } from "../importDetails";
import { FuncShape } from "../../witExtraction";

const col = (col: number): string => {
    return " ".repeat(col * 4);
};

class Func {
    name: string;
    service: string;
    plugin: string;
    intfName: string;
    isDynamic: boolean;

    constructor(
        service: string,
        plugin: string,
        intfName: string,
        name: string,
        isDynamic: boolean,
    ) {
        // Name might look like `[constructor]classname` or `[method]classname.func-name`
        if (name.includes("[method]")) {
            this.name = name.split("]")[1].split(".")[1];
        } else if (name.includes("[constructor]")) {
            this.name = "constructor";
        } else {
            this.name = name;
        }

        this.service = service;
        this.plugin = plugin;
        this.intfName = intfName;
        this.isDynamic = isDynamic;
    }

    private proxy = (): string => {
        let service = `"${this.service}"`;
        let plugin = `"${this.plugin}"`;

        if (this.isDynamic) {
            service = `plugin_ref.name`;
            plugin = `"plugin"`;
        }
        return [
            `${col(2)}return host.syncCall({`,
            `${col(3)}service: ${service},`,
            `${col(3)}plugin: ${plugin},`,
            `${col(3)}intf: "${this.intfName}",`,
            `${col(3)}method: "${this.name}",`,
            `${col(3)}params: args`,
            `${col(2)}});`,
            ``,
        ].join("\n");
    };

    private pre = (): string => {
        if (!this.isDynamic) {
            return `${col(1)}${this.name}(...args) {\n`;
        }
        return `${col(1)}${this.name}(plugin_ref, ...args) {\n`;
    };

    private post = (): string => {
        return `    },\n`;
    };

    code = (): string => {
        return this.pre() + this.proxy() + this.post();
    };
}

class Intf {
    name: string;
    funcs: Func[];

    constructor(
        service: string,
        plugin: string,
        intfName: string,
        funcs: FuncShape[],
    ) {
        // Todo (Resource support): Split funcs array into subsets if there are resources
        //   with grouped methods.
        // Functions that are directly part of an interface can be added as normal,
        //   but resource methods should be added in their own resource object.
        this.name = intfName;
        this.funcs = funcs.map(
            (f) => new Func(service, plugin, intfName, f.name, f.dynamicLink),
        );
    }

    private pre = (): string => {
        return `export const ${this.name} = {\n`;
    };

    private post = (): string => {
        return `};\n`;
    };

    code = (): string => {
        const functions: string[] = this.funcs.map((f) => f.code());
        return this.pre() + functions.join("\n") + this.post();
    };
}

// Most components import functionality from other components, and not just from the host.
// Whenever a component imports functionality from another component, it must be composed with
//   an interface that exports whatever external functionality was imported.
// Rather than compose the two plugins together directly, we proxy the call to the external component
//   through the supervisor syncCall interface, which allows the supervisor to maintain a callstack.
// The callstack then allows then the supervisor to track which app's component is responsible for
//   calling which other app's component. Relatedly, it ensures the components operate in their own
//   namespace (which can be used for various purposes like private data storage unreadable by other
//   components).
export class ProxyPkg {
    namespace: string;
    id: string;
    interfaces: Intf[];

    constructor(ns: string, id: string) {
        this.namespace = ns;
        this.id = id;
        this.interfaces = [];
    }

    private getShimName = (): string => {
        return `./proxy-shim_${this.namespace}_${this.id}.js`;
    };

    private pre = (): string => {
        return `\n/////// SHIM FILE FOR ${this.namespace}:${this.id} ///////////\n\n`;
    };

    private post = (): string => {
        return `\n\n`;
    };

    add = (intf: string, funcs: FuncShape[]) => {
        this.interfaces.push(new Intf(this.namespace, this.id, intf, funcs));
    };

    getImportDetails = (): ImportDetails => {
        const importMap: Array<[PkgId, FilePath]> = [];
        importMap.push([
            `${this.namespace}:${this.id}/*`,
            `${this.getShimName()}#*`,
        ]);

        const interfaces: string[] = this.interfaces.map((i) => i.code());
        const code = this.pre() + interfaces.join("\n") + this.post();
        const shimFile: [FilePath, Code] = [this.getShimName(), code];

        return {
            importMap,
            files: [shimFile],
        };
    };
}
