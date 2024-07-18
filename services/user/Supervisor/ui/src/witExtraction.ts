export interface Interface {
    namespace: string;
    package: string;
    name: string;
    funcs: string[];
}

export interface Functions {
    namespace: string;
    package: string;
    interfaces: Interface[];
    funcs: string[];
}

export interface ComponentAPI {
    importedFuncs: Functions;
    exportedFuncs: Functions;
    wit: string;
    debug: string;
}
