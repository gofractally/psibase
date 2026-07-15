import * as path from "path";
import { constraintViolation } from "./constraints";
import { Diagnostic, ENTITY_META, Location, Occurrence, PackageScan } from "./model";

export function validate(scan: PackageScan): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const occ of scan.occurrences) {
    const msg = constraintViolation(occ.entity, occ.value);
    if (msg) {
      diagnostics.push({
        severity: "error",
        code: constraintCode(occ.entity),
        message: `${ENTITY_META[occ.entity].label}: ${msg}`,
        location: occ.location,
        entity: occ.entity,
        groupId: occ.groupId,
      });
    }
  }

  const groups = new Map<string, Occurrence[]>();
  for (const occ of scan.occurrences) {
    const list = groups.get(occ.groupId) ?? [];
    list.push(occ);
    groups.set(occ.groupId, list);
  }

  for (const [groupId, members] of groups) {
    if (members.length < 2) continue;
    const expected = members[0].value;
    for (let i = 1; i < members.length; i++) {
      const occ = members[i];
      if (occ.value !== expected) {
        diagnostics.push({
          severity: "error",
          code: "correlationMismatch",
          message: `${ENTITY_META[members[0].entity].label} mismatch: expected \`${expected}\` (from ${formatRelativeLocation(scan.packageRoot, members[0].location)}), found \`${occ.value}\``,
          location: occ.location,
          entity: occ.entity,
          groupId,
        });
      }
    }
  }

  validateQuerySubaccountTransform(scan, diagnostics);
  return diagnostics;
}

function constraintCode(entity: string): string {
  return entity === "on_chain_service" || entity === "on_chain_query"
    ? "invalidAccountName"
    : "invalidName";
}

function validateQuerySubaccountTransform(
  scan: PackageScan,
  diagnostics: Diagnostic[],
): void {
  const serviceAccounts = new Map<string, string>();
  for (const occ of scan.occurrences) {
    if (occ.entity === "on_chain_service") {
      const key = occ.groupId.replace("on_chain_service:", "");
      serviceAccounts.set(key, occ.value);
    }
  }

  for (const occ of scan.occurrences) {
    if (occ.entity !== "on_chain_query") continue;
    const key = occ.groupId.replace("on_chain_query:", "");
    const base = serviceAccounts.get(key);
    if (!base) continue;
    const plus = occ.value.indexOf("+");
    if (plus < 0) continue;
    const queryBase = occ.value.slice(0, plus);
    if (queryBase !== base) {
      diagnostics.push({
        severity: "error",
        code: "correlationMismatch",
        message: `On-chain query account must use base \`${base}\` (from on-chain service), found \`${queryBase}\``,
        location: occ.location,
        entity: occ.entity,
        groupId: occ.groupId,
      });
    }
  }
}

export function hoverMarkdown(
  occ: Occurrence,
  correlates: Occurrence[],
  packageRoot: string,
): string {
  const meta = ENTITY_META[occ.entity];
  const lines = [meta.role, "", `Value: \`${occ.value}\``, "", `Convention: ${meta.convention}`];

  const others = correlates.filter(
    (c) =>
      c !== occ &&
      (c.location.file !== occ.location.file ||
        c.location.line !== occ.location.line ||
        c.location.startCol !== occ.location.startCol),
  );
  if (others.length > 0) {
    lines.push("", "Identifier also appears in:");
    for (const other of others) {
      lines.push(
        `- \`${formatRelativeLocation(packageRoot, other.location)}\``,
      );
    }
  }

  return lines.join("\n");
}

export function formatPackageRelativePath(
  packageRoot: string,
  filePath: string,
): string {
  const rel = path.relative(packageRoot, filePath).replace(/\\/g, "/");
  if (!rel || rel === ".") {
    return "./";
  }
  return `./${rel}`;
}

export function formatRelativeLocation(
  packageRoot: string,
  location: Location,
): string {
  return `${formatPackageRelativePath(packageRoot, location.file)}:${location.line}`;
}

export function quickFixForDiagnostic(
  diagnostic: Diagnostic,
  scan: PackageScan,
):
  | { title: string; expected: string; locations: Occurrence["location"][] }
  | undefined {
  if (diagnostic.code !== "correlationMismatch" || !diagnostic.groupId) {
    return undefined;
  }
  const members = scan.occurrences.filter(
    (o) => o.groupId === diagnostic.groupId,
  );
  if (members.length < 2) return undefined;
  const expected =
    members.find((m) => m.location.file !== diagnostic.location.file)?.value ??
    members[0].value;
  if (expected === diagnostic.message.match(/found `([^`]+)`/)?.[1]) {
    return undefined;
  }
  const bad = members.find(
    (m) =>
      m.location.file === diagnostic.location.file &&
      m.location.line === diagnostic.location.line,
  );
  if (!bad || bad.value === expected) return undefined;
  return {
    title: `Use correlated name \`${expected}\``,
    expected,
    locations: [bad.location],
  };
}
