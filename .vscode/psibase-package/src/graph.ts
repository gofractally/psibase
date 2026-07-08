import * as vscode from "vscode";
import { Diagnostic, Occurrence, PackageScan } from "./model";
import {
  cmakeSearchRoots,
  ContentOverrides,
  findPackageRoots,
  scanPackage,
} from "./scan";
import { validate } from "./validate";

export class PackageGraphService {
  private scans = new Map<string, PackageScan>();
  private diagnostics = new Map<string, Diagnostic[]>();
  private readonly onChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onChangeEmitter.event;

  invalidate(): void {
    this.scans.clear();
    this.diagnostics.clear();
    this.onChangeEmitter.fire();
  }

  refresh(workspaceRoot: string, overrides?: ContentOverrides): void {
    this.scans.clear();
    this.diagnostics.clear();

    const roots = findPackageRoots(workspaceRoot);
    for (const root of roots) {
      try {
        const scan = scanPackage(root, cmakeSearchRoots(root), overrides);
        this.scans.set(root, scan);
        this.diagnostics.set(root, validate(scan));
      } catch {
        // skip packages that fail to scan
      }
    }
    this.onChangeEmitter.fire();
  }

  allScans(): PackageScan[] {
    return [...this.scans.values()];
  }

  allDiagnostics(): Diagnostic[] {
    return [...this.diagnostics.values()].flat();
  }

  scanForFile(filePath: string): PackageScan | undefined {
    const normalized = filePath.replace(/\\/g, "/");
    for (const [root, scan] of this.scans) {
      if (normalized.startsWith(root.replace(/\\/g, "/"))) {
        return scan;
      }
    }
    return undefined;
  }

  occurrenceAt(
    filePath: string,
    line: number,
    col: number,
  ): { scan: PackageScan; occurrence: Occurrence } | undefined {
    const scan = this.scanForFile(filePath);
    if (!scan) return undefined;

    const normalized = filePath.replace(/\\/g, "/");
    const matches = scan.occurrences.filter(
      (occ) =>
        occ.location.file.replace(/\\/g, "/") === normalized &&
        occ.location.line === line &&
        col >= occ.location.startCol &&
        col <= occ.location.endCol,
    );
    if (matches.length === 0) return undefined;

    const occurrence = matches.sort(
      (a, b) => b.value.length - a.value.length,
    )[0];
    return { scan, occurrence };
  }

  packageRootForFile(filePath: string): string | undefined {
    return this.scanForFile(filePath)?.packageRoot;
  }
}
