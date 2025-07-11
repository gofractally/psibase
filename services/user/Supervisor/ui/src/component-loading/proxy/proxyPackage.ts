import { Code, FilePath, ImportDetails, PkgId } from "../importDetails";
import { FuncShape } from "../../witExtraction";

const col = (col: number): string => {
    return " ".repeat(col * 4);
};

const toPascalCase = (str: string): string => {
    return str.charAt(0).toUpperCase() + str.slice(1);
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
        this.name = name;
        this.service = service;
        this.plugin = plugin;
        this.intfName = intfName;
        this.isDynamic = isDynamic;
    }

    private proxy = (): string => {

        if (this.isDynamic) {
            let handle = `plugin_ref.handle`;
            return [
                `${col(2)}return host.syncCallDyn({`,
                `${col(3)}handle: ${handle},`,
                `${col(3)}method: "${this.name}",`,
                `${col(3)}params: args`,
                `${col(2)}});`,
                ``,
            ].join("\n");

        }

        let service = `"${this.service}"`;
        let plugin = `"${this.plugin}"`;
        let intf = `"${this.intfName}"`;
        return [
            `${col(2)}return host.syncCall({`,
            `${col(3)}service: ${service},`,
            `${col(3)}plugin: ${plugin},`,
            `${col(3)}intf: ${intf},`,
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
        return `${col(1)}},\n`;
    };

    code = (): string => {
        return this.pre() + this.proxy() + this.post();
    };
}

// ResourceFunc must be separate from Func because unfortunately there are minor differences 
// in the syntax for the bindings. (e.g. the methods don't end with a comma)
class ResourceFunc {
    type: string;
    name: string;
    service: string;
    plugin: string;
    intfName: string;
    isDynamic: boolean;

    constructor(
        service: string,
        plugin: string,
        intfName: string,
        type: string,
        name: string,
        isDynamic: boolean,
    ) {
        // For resources, the name might look like
        // `[constructor]classname`, `[method]classname.func-name`, or `[static]classname.func-name`
        if (name.includes("[method]")) {
            this.name = name.split("]")[1].split(".")[1];
        } else if (name.includes("[constructor]")) {
            this.name = "constructor";
        } else if (name.includes("[static]")) {
            this.name = "static " + name.split("]")[1].split(".")[1];
        } else {
            throw new Error(`Invalid resource method name: ${name}`);
        }

        if (isDynamic) {
            throw new Error(`Dynamic resource methods are not supported`);
        }

        this.service = service;
        this.plugin = plugin;
        this.intfName = intfName;
        this.type = type;
        this.isDynamic = isDynamic;
    }

    private proxy = (): string => {
        let service = `"${this.service}"`;
        let plugin = `"${this.plugin}"`;
        let intf = `"${this.intfName}"`;
        let type = `"${this.type}"`;
        let method = `"${this.name}"`;

        const syncCallResource = [
            `host.syncCallResource({`,
            `${col(4)}service: ${service},`,
            `${col(4)}plugin: ${plugin},`,
            `${col(4)}intf: ${intf},`,
            `${col(4)}type: ${type},`,
            `${col(4)}handle: this.handle,`,
            `${col(4)}method: ${method},`,
            `${col(4)}params: args`,
            `${col(3)}})`,
        ].join("\n");

        if (this.name === "constructor") {
            return [
                `${col(3)}return (this.handle = ${syncCallResource}, this);`,
                ``,
            ].join("\n");
        } else {
            return [
                `${col(3)}return ${syncCallResource};`,
                ``,
            ].join("\n");
        }
    };

    private pre = (): string => {
        return `${col(2)}${this.name}(...args) {\n`;
    };

    private post = (): string => {
        return `${col(2)}}\n`;
    };

    code = (): string => {
        return this.pre() + this.proxy() + this.post();
    };
}

class Resource {
    name: string;
    funcs: ResourceFunc[];

    constructor(name: string, funcs: ResourceFunc[]) {
        this.name = name;
        this.funcs = funcs;
    }

    static isResourceMethod(f: FuncShape) {
        return f.name.includes("[constructor]")
            || f.name.includes("[method]")
            || f.name.includes("[static]");
    }

    static resourceName(fname: string) {
        const bracketIndex = fname.indexOf("]");
        const dotIndex = fname.indexOf(".", bracketIndex);

        return dotIndex !== -1
            ? fname.substring(bracketIndex + 1, dotIndex)
            : fname.substring(bracketIndex + 1);
    }

    public get(name: string) {
        return this.funcs.find((f) => f.name === name);
    }

    public addFunc(f: ResourceFunc) {
        this.funcs.push(f);
    }

    private pre = (): string => {
        return `${col(1)}${this.name}: class {\n`;
    };

    private post = (): string => {
        return `${col(1)}},\n`;
    };

    public code(): string {
        const functions: string[] = this.funcs.map((f) => f.code());
         return this.pre() + functions.join("\n") + this.post();
    }
}

class Resources {
    resources: Resource[];

    constructor() {
        this.resources = [];
    }

    public get(name: string): Resource {
        let resource = this.resources.find((r) => r.name === name);
        if (!resource) {
            resource = new Resource(name, []);
            this.resources.push(resource);
        }
        return resource;
    }

    public code(): string[] {
        return this.resources.map((r) => r.code());
    }
}

class Intf {
    name: string;
    funcs: Func[] = [];
    resources: Resources = new Resources();

    constructor(
        service: string,
        plugin: string,
        intfName: string,
        funcs: FuncShape[],
    ) {
        this.name = intfName;
        funcs.forEach((f) => {
            if (Resource.isResourceMethod(f)) {
                const resourceName = toPascalCase(Resource.resourceName(f.name));
                this.resources.get(resourceName).addFunc(new ResourceFunc(service, plugin, intfName, resourceName, f.name, f.dynamicLink));
            } else {
                this.funcs.push(new Func(service, plugin, intfName, f.name, f.dynamicLink));
            }
        });
    }

    private pre = (): string => {
        return `export const ${this.name} = {\n`;
    };

    private post = (): string => {
        return `};\n`;
    };

    code = (): string => {
        const functions: string[] = this.funcs.map((f) => f.code());
        const resourceFuncs: string[] = this.resources.code();
        return this.pre() + resourceFuncs.join("\n") + functions.join("\n") + this.post();
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
