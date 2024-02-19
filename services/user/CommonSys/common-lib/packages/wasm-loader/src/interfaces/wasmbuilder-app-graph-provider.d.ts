export namespace WasmbuilderAppGraphProvider {
  export { Graph };
}
/**
 * # Variants
 * 
 * ## `"module"`
 * 
 * ## `"function"`
 * 
 * ## `"value"`
 * 
 * ## `"type"`
 * 
 * ## `"instance"`
 * 
 * ## `"component"`
 */
export type ItemKind = 'module' | 'function' | 'value' | 'type' | 'instance' | 'component';
export interface Import {
  name: string,
  kind: ItemKind,
}
export interface Export {
  name: string,
  kind: ItemKind,
}
export type ComponentId = number;
export interface Component {
  id: ComponentId,
  name: string,
  imports: Import[],
  exports: Export[],
  wit: string,
}
export type InstanceId = number;
export interface EncodeOptions {
  defineComponents: boolean,
  'export'?: InstanceId,
  validate: boolean,
}

export class Graph {
  constructor()
  addComponent(name: string, bytes: Uint8Array): Component;
  instantiateComponent(id: ComponentId): InstanceId;
  connectInstances(source: InstanceId, sourceExport: number | undefined, target: InstanceId, targetImport: number): void;
  removeComponent(id: ComponentId): void;
  removeInstance(id: InstanceId): void;
  disconnectInstances(source: InstanceId, target: InstanceId, targetImport: number): void;
  printGraph(): string;
  encodeGraph(options: EncodeOptions): Uint8Array;
}
