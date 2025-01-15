export interface SchemaParam {
  name: string;
  type: unknown;
}

export interface SchemaFunction {
  name: string;
  params: SchemaParam[];
  interfaceName: string;
}

export interface SchemaInterface {
  name?: string;
  functions?: Record<string, SchemaFunction>;
}

export interface ExportedInterface {
  interface: {
    id: number;
  };
}

export interface World {
  name: string;
  exports?: Record<string, ExportedInterface>;
}

export interface TypeDefinition {
  kind: {
    record?: {
      fields: Array<{
        name: string;
        type: unknown;
      }>;
    };
    list?: unknown;
    type?: string;
    option?: unknown;
    tuple?: {
      types: unknown[];
    };
    variant?: {
      cases: Array<{
        name: string;
        type?: unknown;
      }>;
    };
  };
}

export interface Schema {
  worlds: World[];
  interfaces: SchemaInterface[];
  types: TypeDefinition[];
}

export interface ExportedMethodsByInterface {
  [interfaceName: string]: SchemaFunction[];
}
