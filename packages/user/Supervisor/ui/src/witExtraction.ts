export interface FuncShape {
    name: string;
    dynamicLink: boolean;
}

export interface Interface {
    namespace: string;
    package: string;
    name: string;
    funcs: FuncShape[];
}

export interface Functions {
    namespace: string;
    package: string;
    interfaces: Interface[];
    funcs: FuncShape[];
}

export interface ComponentAPI {
    importedFuncs: Functions;
    exportedFuncs: Functions;
    wit: string;
    debug: string;
}
