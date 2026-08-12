import * as vscode from "vscode";
import { ContentOverrides } from "./scan";

export function isPackageRelevantDocument(doc: vscode.TextDocument): boolean {
  if (doc.uri.scheme !== "file") return false;
  return (
    doc.fileName.endsWith("Cargo.toml") ||
    doc.fileName.endsWith(".rs") ||
    doc.fileName.endsWith(".wit") ||
    doc.fileName.endsWith("CMakeLists.txt")
  );
}

export function collectContentOverrides(): ContentOverrides {
  const overrides = new Map<string, string>();
  for (const doc of vscode.workspace.textDocuments) {
    if (!doc.isDirty || !isPackageRelevantDocument(doc)) continue;
    overrides.set(doc.uri.fsPath, doc.getText());
  }
  return overrides;
}
