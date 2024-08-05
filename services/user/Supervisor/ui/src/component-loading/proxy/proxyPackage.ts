import { Code, FilePath, ImportDetails, PkgId } from "../importDetails";

class Func {
    name: string;

    constructor(name: string) {
        this.name = name;
    }

    private pre = (): string => {
        return `    ${this.name}(...args) {\n`;
    };

    private post = (): string => {
        return `    }\n`;
    };

    code = (proxy: string): string => {
        return this.pre() + proxy + this.post();
    };
}

class Intf {
    name: string;
    funcs: Func[];

    constructor(name: string, funcs: string[]) {
        this.name = name;
        this.funcs = funcs.map((f) => new Func(f));
    }

    private pre = (): string => {
        return `export const ${this.name} = {\n`;
    };

    private post = (): string => {
        return `};\n`;
    };

    code = (proxy: (intfName: string, funcName: string) => string): string => {
        const functions: string[] = this.funcs.map((f) =>
            f.code(proxy(this.name, f.name)),
        );
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

    private proxy = (): ((intfName: string, funcName: string) => string) => {
        const col = (col: number): string => {
            return " ".repeat(col * 4);
        };
        return (intfName: string, funcName: string): string => {
            return [
                `${col(2)}return host.syncCall({`,
                `${col(3)}service: "${this.namespace}",`,
                `${col(3)}plugin: "${this.id}",`,
                `${col(3)}intf: "${intfName}",`,
                `${col(3)}method: "${funcName}",`,
                `${col(3)}params: args`,
                `${col(2)}});`,
                ``,
            ].join("\n");
        };
    };

    private pre = (): string => {
        return `\n/////// SHIM FILE FOR ${this.namespace}:${this.id} ///////////\n\n`;
    };

    private post = (): string => {
        return `\n\n`;
    };

    add = (intf: string, funcs: string[]) => {
        this.interfaces.push(new Intf(intf, funcs));
    };

    getImportDetails = (): ImportDetails => {
        const importMap: Array<[PkgId, FilePath]> = [];
        importMap.push([
            `${this.namespace}:${this.id}/*`,
            `${this.getShimName()}#*`,
        ]);

        const interfaces: string[] = this.interfaces.map((i) =>
            i.code(this.proxy()),
        );
        const code = this.pre() + interfaces.join("\n") + this.post();
        const shimFile: [FilePath, Code] = [this.getShimName(), code];

        return {
            importMap,
            files: [shimFile],
        };
    };
}
