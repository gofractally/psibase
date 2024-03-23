export let packagesUrl: string;
export function plugin(files: any): {
    name: string;
    resolveId(importee: any, importer: any): Promise<any>;
    load(id: any): Promise<any>;
    transform(code: any, id: any): Promise<{
        code: any;
        map: {
            mappings: string;
        };
    } | undefined>;
};
export default plugin;
