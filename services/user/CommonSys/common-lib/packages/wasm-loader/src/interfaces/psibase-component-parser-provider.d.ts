export namespace PsibaseComponentParserProvider {
  export { ComponentParser };
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
export interface Component {
  name: string,
  imports: Import[],
  exports: Export[],
  wit: string,
}

export class ComponentParser {
  constructor()
  parse(name: string, bytes: Uint8Array): Component;
}
