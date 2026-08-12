import * as vscode from "vscode";
import { collectContentOverrides, isPackageRelevantDocument } from "./buffers";
import { PackageGraphService } from "./graph";
import {
  findCorrelated,
  registerCodeActions,
  registerDiagnostics,
  registerHover,
  registerInlayHints,
  registerRenameProvider,
  registerSemanticTokens,
  registerStatusBar,
  renameEntity,
} from "./providers";

export function activate(context: vscode.ExtensionContext): void {
  const graphs = new PackageGraphService();

  const refreshAll = () => {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      graphs.refresh(folder.uri.fsPath, collectContentOverrides());
    }
  };

  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshAll(), 150);
  };

  refreshAll();

  registerDiagnostics(context, graphs);
  registerHover(context, graphs);
  registerInlayHints(context, graphs);
  registerCodeActions(context, graphs);
  registerSemanticTokens(context, graphs);
  registerRenameProvider(context, graphs);
  registerStatusBar(context, graphs);

  context.subscriptions.push(
    vscode.commands.registerCommand("psibasePackage.renameEntity", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      await renameEntity(graphs, editor, refreshAll);
    }),
    vscode.commands.registerCommand(
      "psibasePackage.findCorrelated",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        await findCorrelated(graphs, editor);
      },
    ),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (isPackageRelevantDocument(event.document)) {
        scheduleRefresh();
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (isPackageRelevantDocument(doc)) {
        scheduleRefresh();
      }
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (isPackageRelevantDocument(doc)) {
        refreshAll();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => refreshAll()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("psibasePackage")) {
        refreshAll();
      }
    }),
  );
}

export function deactivate(): void {}
