import { FunctionCallArgs } from "@psibase/common-lib";

export function camelCase(str: string): string {
  return str
    .split(/[-_ ]+/)
    .map((w, i) =>
      i === 0
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join("");
}

export function withArgs(
  service: string,
  plugin: string,
  intf: string,
  method: string,
  params: unknown[] = []
): FunctionCallArgs {
  return {
    service,
    plugin,
    intf,
    method,
    params,
  };
}
