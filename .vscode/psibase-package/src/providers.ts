import * as vscode from "vscode";
import { PackageGraphService } from "./graph";
import { ENTITY_META } from "./model";
import { groupOccurrences } from "./scan";
import { hoverMarkdown, quickFixForDiagnostic } from "./validate";

const DIAGNOSTIC_SOURCE = "psibase-package";

export function registerDiagnostics(
  context: vscode.ExtensionContext,
  graphs: PackageGraphService,
): vscode.Disposable {
  const collection =
    vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);

  const publish = () => {
    collection.clear();
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const diagnostic of graphs.allDiagnostics()) {
      const uri = vscode.Uri.file(diagnostic.location.file);
      const key = uri.toString();
      const list = byFile.get(key) ?? [];
      const range = new vscode.Range(
        diagnostic.location.line - 1,
        diagnostic.location.startCol,
        diagnostic.location.line - 1,
        diagnostic.location.endCol,
      );
      list.push({
        range,
        message: diagnostic.message,
        severity:
          diagnostic.severity === "error"
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning,
        source: DIAGNOSTIC_SOURCE,
        code: diagnostic.code,
      });
      byFile.set(key, list);
    }
    for (const [uri, diags] of byFile) {
      collection.set(vscode.Uri.parse(uri), diags);
    }
  };

  publish();
  context.subscriptions.push(collection, graphs.onDidChange(publish));
  return collection;
}

export function registerHover(
  context: vscode.ExtensionContext,
  graphs: PackageGraphService,
): void {
  const provider: vscode.HoverProvider = {
    provideHover(document, position) {
      const hit = graphs.occurrenceAt(
        document.uri.fsPath,
        position.line + 1,
        position.character,
      );
      if (!hit) return undefined;
      const correlates = groupOccurrences(hit.scan, hit.occurrence.groupId);
      const md = new vscode.MarkdownString(
        hoverMarkdown(hit.occurrence, correlates, hit.scan.packageRoot),
      );
      md.isTrusted = true;
      return new vscode.Hover(md);
    },
  };

  for (const lang of ["toml", "rust", "wit"]) {
    context.subscriptions.push(
      vscode.languages.registerHoverProvider(
        { language: lang, scheme: "file" },
        provider,
      ),
    );
  }
}

export function registerInlayHints(
  context: vscode.ExtensionContext,
  graphs: PackageGraphService,
): void {
  const changeEmitter = new vscode.EventEmitter<void>();

  const provider: vscode.InlayHintsProvider = {
    onDidChangeInlayHints: changeEmitter.event,
    provideInlayHints(document, range) {
      if (
        !vscode.workspace
          .getConfiguration("psibasePackage")
          .get("inlayHints.enabled", true)
      ) {
        return [];
      }

      const scan = graphs.scanForFile(document.uri.fsPath);
      if (!scan) return [];

      const hints: vscode.InlayHint[] = [];
      const eolByLine = new Map<
        number,
        { labels: string[]; tooltips: Map<string, string> }
      >();

      for (const occ of scan.occurrences) {
        if (
          occ.location.file.replace(/\\/g, "/") !==
          document.uri.fsPath.replace(/\\/g, "/")
        ) {
          continue;
        }
        const line = occ.location.line - 1;
        if (line < range.start.line || line > range.end.line) continue;

        const meta = ENTITY_META[occ.entity];
        const suffix = occ.inlayPlural ? "(s)" : "";
        const label = `← ${meta.label}${suffix}`;

        if (occ.inlayInline) {
          hints.push({
            position: new vscode.Position(line, occ.location.endCol),
            label,
            paddingLeft: true,
            tooltip: meta.convention,
          });
          continue;
        }

        let entry = eolByLine.get(line);
        if (!entry) {
          entry = { labels: [], tooltips: new Map() };
          eolByLine.set(line, entry);
        }
        if (!entry.labels.includes(label)) {
          entry.labels.push(label);
          entry.tooltips.set(label, meta.convention);
        }
      }

      for (const [line, { labels, tooltips }] of eolByLine) {
        const endCol = document.lineAt(line).text.trimEnd().length;
        for (let i = 0; i < labels.length; i++) {
          const label = labels[i];
          hints.push({
            position: new vscode.Position(line, endCol),
            label,
            paddingLeft: i > 0,
            tooltip: tooltips.get(label),
          });
        }
      }
      return hints;
    },
  };

  context.subscriptions.push(
    changeEmitter,
    graphs.onDidChange(() => changeEmitter.fire()),
    vscode.languages.registerInlayHintsProvider(
      { language: "toml", scheme: "file" },
      provider,
    ),
    vscode.languages.registerInlayHintsProvider(
      { language: "rust", scheme: "file" },
      provider,
    ),
    vscode.languages.registerInlayHintsProvider(
      { language: "wit", scheme: "file" },
      provider,
    ),
  );
}

export function registerCodeActions(
  context: vscode.ExtensionContext,
  graphs: PackageGraphService,
): void {
  const provider: vscode.CodeActionProvider = {
    provideCodeActions(document, range) {
      const actions: vscode.CodeAction[] = [];
      const scan = graphs.scanForFile(document.uri.fsPath);
      if (!scan) return actions;

      for (const diagnostic of graphs.allDiagnostics()) {
        if (
          normalizePath(diagnostic.location.file) !==
          normalizePath(document.uri.fsPath)
        ) {
          continue;
        }
        const diagRange = new vscode.Range(
          diagnostic.location.line - 1,
          diagnostic.location.startCol,
          diagnostic.location.line - 1,
          diagnostic.location.endCol,
        );
        if (!range.intersection(diagRange)) continue;

        const fix = quickFixForDiagnostic(diagnostic, scan);
        if (!fix) continue;

        const action = new vscode.CodeAction(
          fix.title,
          vscode.CodeActionKind.QuickFix,
        );
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, diagRange, fix.expected);
        action.diagnostics = [
          {
            range: diagRange,
            message: diagnostic.message,
            severity: vscode.DiagnosticSeverity.Error,
            source: DIAGNOSTIC_SOURCE,
            code: diagnostic.code,
          },
        ];
        actions.push(action);
      }
      return actions;
    },
  };

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      [{ language: "toml" }, { language: "rust" }, { language: "wit" }],
      provider,
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );
}

export function registerSemanticTokens(
  context: vscode.ExtensionContext,
  graphs: PackageGraphService,
): void {
  const styles: Record<string, vscode.TextEditorDecorationType> = {
    package_crate: namingDecoration("#9CDCFE"),
    service_crate: namingDecoration("#4FC1FF"),
    query_crate: namingDecoration("#C586C0"),
    plugin_crate: namingDecoration("#DCDCAA"),
    wit_package: namingDecoration("#4EC9B0"),
    external_plugin: namingDecoration("#89D185"),
    on_chain_service: namingDecoration("#CE9178"),
    on_chain_query: namingDecoration("#D7BA7D"),
    published_package: namingDecoration("#F44747"),
  };

  const applyToEditor = (editor: vscode.TextEditor) => {
    if (!isHighlightableDocument(editor.document)) return;

    const enabled = vscode.workspace
      .getConfiguration("psibasePackage")
      .get("semanticHighlighting.enabled", true);

    const docPath = normalizePath(editor.document.uri.fsPath);
    const rangesByEntity = new Map<string, vscode.Range[]>();
    for (const entity of Object.keys(styles)) {
      rangesByEntity.set(entity, []);
    }

    if (enabled) {
      const scan = graphs.scanForFile(editor.document.uri.fsPath);
      if (scan) {
        for (const occ of scan.occurrences) {
          if (normalizePath(occ.location.file) !== docPath) continue;
          const ranges = rangesByEntity.get(occ.entity);
          if (!ranges) continue;
          ranges.push(
            new vscode.Range(
              occ.location.line - 1,
              occ.location.startCol,
              occ.location.line - 1,
              occ.location.endCol,
            ),
          );
        }
      }
    }

    for (const [entity, style] of Object.entries(styles)) {
      editor.setDecorations(style, rangesByEntity.get(entity) ?? []);
    }
  };

  const updateAllEditors = () => {
    for (const editor of vscode.window.visibleTextEditors) {
      applyToEditor(editor);
    }
  };

  context.subscriptions.push(
    ...Object.values(styles),
    graphs.onDidChange(updateAllEditors),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) applyToEditor(editor);
    }),
    vscode.window.onDidChangeVisibleTextEditors(updateAllEditors),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("psibasePackage.semanticHighlighting")) {
        updateAllEditors();
      }
    }),
  );
  updateAllEditors();
}

function namingDecoration(color: string): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    color,
    backgroundColor: `${color}33`,
    fontWeight: "600",
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
}

function isHighlightableDocument(document: vscode.TextDocument): boolean {
  const lang = document.languageId;
  if (lang === "toml" || lang === "rust" || lang === "wit") {
    return true;
  }
  const name = document.fileName.replace(/\\/g, "/");
  return name.endsWith(".wit") || name.endsWith("CMakeLists.txt");
}

export async function renameEntity(
  graphs: PackageGraphService,
  editor: vscode.TextEditor,
  refreshAll?: () => void,
): Promise<void> {
  const pos = editor.selection.active;
  const hit = graphs.occurrenceAt(
    editor.document.uri.fsPath,
    pos.line + 1,
    pos.character,
  );
  if (!hit) {
    vscode.window.showInformationMessage("No psibase naming slot at cursor.");
    return;
  }

  const group = groupOccurrences(hit.scan, hit.occurrence.groupId);
  const newName = await vscode.window.showInputBox({
    title: "Psibase package: Rename entity",
    prompt: `${ENTITY_META[hit.occurrence.entity].label}`,
    value: hit.occurrence.value,
    validateInput(value) {
      if (!value) return "Name must not be empty";
      return undefined;
    },
  });
  if (!newName || newName === hit.occurrence.value) return;

  const edit = new vscode.WorkspaceEdit();
  for (const occ of group) {
    const uri = vscode.Uri.file(occ.location.file);
    const range = new vscode.Range(
      occ.location.line - 1,
      occ.location.startCol,
      occ.location.line - 1,
      occ.location.endCol,
    );

    let replacement = newName;
    if (
      occ.entity === "on_chain_query" &&
      hit.occurrence.entity === "on_chain_service"
    ) {
      const plus = occ.value.indexOf("+");
      if (plus >= 0) {
        replacement = `${newName}${occ.value.slice(plus)}`;
      }
    } else if (
      occ.entity === "on_chain_query" &&
      hit.occurrence.entity === "on_chain_query"
    ) {
      const plus = occ.value.indexOf("+");
      const base = plus >= 0 ? occ.value.slice(0, plus) : occ.value;
      const suffix = plus >= 0 ? occ.value.slice(plus) : "";
      if (base === hit.occurrence.value.replace(/\+.*$/, "")) {
        replacement = `${newName}${suffix}`;
      }
    }

    edit.replace(uri, range, replacement);
  }

  const ok = await vscode.workspace.applyEdit(edit);
  if (ok && refreshAll) {
    refreshAll();
  }
}

export async function findCorrelated(
  graphs: PackageGraphService,
  editor: vscode.TextEditor,
): Promise<void> {
  const pos = editor.selection.active;
  const hit = graphs.occurrenceAt(
    editor.document.uri.fsPath,
    pos.line + 1,
    pos.character,
  );
  if (!hit) {
    vscode.window.showInformationMessage("No psibase naming slot at cursor.");
    return;
  }

  const items = groupOccurrences(hit.scan, hit.occurrence.groupId).map(
    (occ) => ({
      label: occ.value,
      description: `${ENTITY_META[occ.entity].label} · ${occ.location.file}:${occ.location.line}`,
      occurrence: occ,
    }),
  );

  const picked = await vscode.window.showQuickPick(items, {
    title: "Psibase package: Correlated names",
    placeHolder: hit.occurrence.groupId,
  });
  if (!picked) return;

  const doc = await vscode.workspace.openTextDocument(
    picked.occurrence.location.file,
  );
  const editor2 = await vscode.window.showTextDocument(doc);
  const pos2 = new vscode.Position(
    picked.occurrence.location.line - 1,
    picked.occurrence.location.startCol,
  );
  editor2.selection = new vscode.Selection(pos2, pos2);
  editor2.revealRange(new vscode.Range(pos2, pos2));
}

export function registerStatusBar(
  context: vscode.ExtensionContext,
  graphs: PackageGraphService,
): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  item.command = "psibasePackage.findCorrelated";

  const update = () => {
    if (
      !vscode.workspace
        .getConfiguration("psibasePackage")
        .get("statusBar.enabled", true)
    ) {
      item.hide();
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      item.hide();
      return;
    }

    const pos = editor.selection.active;
    const hit = graphs.occurrenceAt(
      editor.document.uri.fsPath,
      pos.line + 1,
      pos.character,
    );

    const fileDiags = graphs
      .allDiagnostics()
      .filter(
        (d) =>
          normalizePath(d.location.file) ===
          normalizePath(editor.document.uri.fsPath),
      );

    if (hit) {
      item.text = `${ENTITY_META[hit.occurrence.entity].label} · psibase package`;
      item.tooltip =
        "Psibase package naming slot (click to find correlated names)";
      item.show();
    } else {
      const pkg = graphs.packageRootForFile(editor.document.uri.fsPath);
      if (pkg) {
        item.text = `${pathBasename(pkg)} package`;
        item.tooltip = "Inside a psibase package tree";
        item.show();
      } else if (fileDiags.length > 0) {
        item.text = `$(warning) ${fileDiags.length} naming`;
        item.tooltip = "Psibase package naming diagnostics in this file";
        item.show();
      } else {
        item.hide();
      }
    }
  };

  context.subscriptions.push(
    item,
    vscode.window.onDidChangeActiveTextEditor(update),
    vscode.window.onDidChangeTextEditorSelection(update),
    vscode.workspace.onDidChangeTextDocument(() => update()),
    graphs.onDidChange(update),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("psibasePackage.statusBar")) update();
    }),
  );
  update();
  return item;
}

function pathBasename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? p;
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function registerRenameProvider(
  context: vscode.ExtensionContext,
  graphs: PackageGraphService,
): void {
  const provider: vscode.RenameProvider = {
    prepareRename(document, position) {
      const hit = graphs.occurrenceAt(
        document.uri.fsPath,
        position.line + 1,
        position.character,
      );
      if (!hit) return undefined;
      return new vscode.Range(
        hit.occurrence.location.line - 1,
        hit.occurrence.location.startCol,
        hit.occurrence.location.line - 1,
        hit.occurrence.location.endCol,
      );
    },
    provideRenameEdits(document, position, newName) {
      const hit = graphs.occurrenceAt(
        document.uri.fsPath,
        position.line + 1,
        position.character,
      );
      if (!hit) return undefined;

      const group = groupOccurrences(hit.scan, hit.occurrence.groupId);
      const edit = new vscode.WorkspaceEdit();
      for (const occ of group) {
        let replacement = newName;
        if (occ.entity === "on_chain_query") {
          const plus = occ.value.indexOf("+");
          if (plus >= 0 && hit.occurrence.entity === "on_chain_service") {
            replacement = `${newName}${occ.value.slice(plus)}`;
          }
        }
        edit.replace(
          vscode.Uri.file(occ.location.file),
          new vscode.Range(
            occ.location.line - 1,
            occ.location.startCol,
            occ.location.line - 1,
            occ.location.endCol,
          ),
          replacement,
        );
      }
      return edit;
    },
  };

  for (const lang of ["toml", "rust", "wit"]) {
    context.subscriptions.push(
      vscode.languages.registerRenameProvider(
        { language: lang, scheme: "file" },
        provider,
      ),
    );
  }
}
