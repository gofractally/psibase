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

export interface Schema {
  worlds: World[];
  interfaces: SchemaInterface[];
}

export interface ExportedMethodsByInterface {
  [interfaceName: string]: SchemaFunction[];
}
