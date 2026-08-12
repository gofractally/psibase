import * as fs from "fs";
import * as path from "path";
import * as TOML from "@iarna/toml";
import { EntityType, Location, Occurrence, PackageScan } from "./model";

export type ContentOverrides = ReadonlyMap<string, string>;

function normalizePath(filePath: string): string {
  return path.normalize(filePath).replace(/\\/g, "/");
}

function readContent(filePath: string, overrides?: ContentOverrides): string {
  if (overrides) {
    const norm = normalizePath(filePath);
    for (const [key, value] of overrides) {
      if (normalizePath(key) === norm) {
        return value;
      }
    }
  }
  return fs.readFileSync(filePath, "utf8");
}

export function scanPackage(
  packageRoot: string,
  cmakeSearchRoots: string[],
  overrides?: ContentOverrides,
): PackageScan {
  const rootTomlPath = path.join(packageRoot, "Cargo.toml");
  const rootContent = readContent(rootTomlPath, overrides);
  const rootToml = TOML.parse(rootContent) as Record<string, unknown>;
  const occurrences: Occurrence[] = [];

  const packageSection = rootToml.package as
    | Record<string, unknown>
    | undefined;
  const psibaseMeta = (
    packageSection?.metadata as Record<string, unknown> | undefined
  )?.psibase as Record<string, unknown> | undefined;

  const publishedName = psibaseMeta?.["package-name"] as string | undefined;
  if (!publishedName) {
    throw new Error("missing package.metadata.psibase.package-name");
  }

  pushTomlString(
    occurrences,
    rootTomlPath,
    rootContent,
    "published_package",
    "published_package",
    publishedName,
    ["package-name"],
  );

  const packageCrate = packageSection?.name as string | undefined;
  if (packageCrate) {
    pushTomlString(
      occurrences,
      rootTomlPath,
      rootContent,
      "package_crate",
      "package_crate",
      packageCrate,
      ["name"],
    );
  }

  const services = psibaseMeta?.services as string[] | undefined;
  if (!services?.length) {
    throw new Error("missing package.metadata.psibase.services");
  }

  const deps = (rootToml.dependencies as Record<string, unknown>) ?? {};

  for (const serviceName of services) {
    const group = `service_crate:${serviceName}`;
    pushTomlString(
      occurrences,
      rootTomlPath,
      rootContent,
      "service_crate",
      group,
      serviceName,
      ["services"],
      { inlayPlural: true },
    );
    if (deps[serviceName]) {
      pushTomlKey(
        occurrences,
        rootTomlPath,
        rootContent,
        "service_crate",
        group,
        serviceName,
        { inlayInline: true },
      );
    }

    const serviceDir =
      dependencyPath(deps, serviceName, packageRoot) ??
      path.join(packageRoot, "service");
    scanService(occurrences, packageRoot, serviceDir, serviceName, overrides);
  }

  scanCmakeOutputs(occurrences, packageRoot, cmakeSearchRoots, overrides);
  return { packageRoot, occurrences };
}

function scanService(
  occurrences: Occurrence[],
  packageRoot: string,
  serviceDir: string,
  serviceKey: string,
  overrides?: ContentOverrides,
): void {
  const serviceTomlPath = path.join(serviceDir, "Cargo.toml");
  if (!fs.existsSync(serviceTomlPath)) return;

  const serviceContent = readContent(serviceTomlPath, overrides);
  const serviceToml = TOML.parse(serviceContent) as Record<string, unknown>;
  const serviceGroup = `service_crate:${serviceKey}`;

  const serviceCrate =
    ((serviceToml.package as Record<string, unknown> | undefined)?.name as
      | string
      | undefined) ?? serviceKey;

  pushTomlString(
    occurrences,
    serviceTomlPath,
    serviceContent,
    "service_crate",
    serviceGroup,
    serviceCrate,
    ["name"],
  );

  const rootTomlPath = path.join(packageRoot, "Cargo.toml");
  const rootContent = readContent(rootTomlPath, overrides);
  const rootToml = TOML.parse(rootContent) as Record<string, unknown>;
  const rootDeps = (rootToml.dependencies as Record<string, unknown>) ?? {};
  const pkgCrate = (rootToml.package as Record<string, unknown> | undefined)
    ?.name as string | undefined;

  const devDeps =
    (serviceToml["dev-dependencies"] as Record<string, unknown>) ?? {};
  if (pkgCrate && devDeps[pkgCrate]) {
    pushTomlKey(
      occurrences,
      serviceTomlPath,
      serviceContent,
      "package_crate",
      "package_crate",
      pkgCrate,
      { inlayInline: true },
    );
  }

  const psibaseMeta = (
    (serviceToml.package as Record<string, unknown> | undefined)?.metadata as
      | Record<string, unknown>
      | undefined
  )?.psibase as Record<string, unknown> | undefined;

  if (psibaseMeta?.server) {
    const server = String(psibaseMeta.server);
    if (server === serviceCrate) {
      pushTomlString(
        occurrences,
        serviceTomlPath,
        serviceContent,
        "service_crate",
        serviceGroup,
        server,
        ["server"],
      );
    } else {
      const queryGroup = `query_crate:${serviceKey}`;
      pushTomlString(
        occurrences,
        serviceTomlPath,
        serviceContent,
        "query_crate",
        queryGroup,
        server,
        ["server"],
      );

      if (rootDeps[server]) {
        pushTomlKey(
          occurrences,
          rootTomlPath,
          rootContent,
          "query_crate",
          queryGroup,
          server,
          { inlayInline: true },
        );
      }

      const serviceDeps =
        (serviceToml.dependencies as Record<string, unknown>) ?? {};
      const queryDir =
        dependencyPath(serviceDeps, server, path.dirname(serviceDir)) ??
        dependencyPath(rootDeps, server, packageRoot) ??
        path.join(packageRoot, "query-service");
      scanQuery(occurrences, queryDir, serviceKey, overrides);
    }
  }

  if (psibaseMeta?.plugin) {
    const plugin = String(psibaseMeta.plugin);
    const pluginGroup = `plugin_crate:${serviceKey}`;
    pushTomlString(
      occurrences,
      serviceTomlPath,
      serviceContent,
      "plugin_crate",
      pluginGroup,
      plugin,
      ["plugin"],
    );

    if (rootDeps[plugin]) {
      pushTomlKey(
        occurrences,
        rootTomlPath,
        rootContent,
        "plugin_crate",
        pluginGroup,
        plugin,
        { inlayInline: true },
      );
    }

    const pluginDir =
      dependencyPath(rootDeps, plugin, packageRoot) ??
      path.join(packageRoot, "plugin");
    scanPlugin(occurrences, pluginDir, serviceKey, overrides);
  }

  if (Array.isArray(psibaseMeta?.postinstall)) {
    const chainGroup = `on_chain_service:${serviceKey}`;
    const onChainName = findOnChainServiceName(serviceDir, overrides);
    for (const action of psibaseMeta.postinstall as Record<string, unknown>[]) {
      const sender = action.sender as string | undefined;
      const service = action.service as string | undefined;
      if (sender && sender === service && onChainName === sender) {
        pushTomlFieldString(
          occurrences,
          serviceTomlPath,
          serviceContent,
          "on_chain_service",
          chainGroup,
          "sender",
          sender,
          ["postinstall", "sender"],
        );
        pushTomlFieldString(
          occurrences,
          serviceTomlPath,
          serviceContent,
          "on_chain_service",
          chainGroup,
          "service",
          service,
          ["postinstall", "service"],
        );
      }
    }
  }

  scanRustServiceAccount(occurrences, serviceDir, serviceKey, overrides);
}

function findOnChainServiceName(
  serviceDir: string,
  overrides?: ContentOverrides,
): string | undefined {
  const src = path.join(serviceDir, "src");
  if (!fs.existsSync(src)) return undefined;
  const re = /#\[psibase::service\s*\(\s*name\s*=\s*"([^"]+)"/;
  return findRustMacroValue(src, re, overrides);
}

function findRustMacroValue(
  dir: string,
  re: RegExp,
  overrides?: ContentOverrides,
): string | undefined {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findRustMacroValue(full, re, overrides);
      if (found) return found;
    } else if (entry.name.endsWith(".rs")) {
      const content = readContent(full, overrides);
      const match = re.exec(content);
      if (match) return match[1];
    }
  }
  return undefined;
}

function scanQuery(
  occurrences: Occurrence[],
  queryDir: string,
  serviceKey: string,
  overrides?: ContentOverrides,
): void {
  const queryTomlPath = path.join(queryDir, "Cargo.toml");
  if (!fs.existsSync(queryTomlPath)) return;

  const queryContent = readContent(queryTomlPath, overrides);
  const queryToml = TOML.parse(queryContent) as Record<string, unknown>;
  const queryGroup = `query_crate:${serviceKey}`;

  const name = (queryToml.package as Record<string, unknown> | undefined)
    ?.name as string | undefined;
  if (name) {
    pushTomlString(
      occurrences,
      queryTomlPath,
      queryContent,
      "query_crate",
      queryGroup,
      name,
      ["name"],
    );
  }

  scanRustQueryAccount(occurrences, queryDir, serviceKey, overrides);
}

function scanPlugin(
  occurrences: Occurrence[],
  pluginDir: string,
  serviceKey: string,
  overrides?: ContentOverrides,
): void {
  const pluginTomlPath = path.join(pluginDir, "Cargo.toml");
  if (!fs.existsSync(pluginTomlPath)) return;

  const pluginContent = readContent(pluginTomlPath, overrides);
  const pluginToml = TOML.parse(pluginContent) as Record<string, unknown>;
  const pluginGroup = `plugin_crate:${serviceKey}`;

  const name = (pluginToml.package as Record<string, unknown> | undefined)
    ?.name as string | undefined;
  if (name) {
    pushTomlString(
      occurrences,
      pluginTomlPath,
      pluginContent,
      "plugin_crate",
      pluginGroup,
      name,
      ["name"],
    );
  }

  const pluginDeps = (pluginToml.dependencies as Record<string, unknown>) ?? {};
  if (pluginDeps[serviceKey]) {
    pushTomlKey(
      occurrences,
      pluginTomlPath,
      pluginContent,
      "service_crate",
      `service_crate:${serviceKey}`,
      serviceKey,
      { inlayInline: true },
    );
  }

  const componentTargetDeps = (
    (
      (pluginToml.package as Record<string, unknown> | undefined)?.metadata as
        | Record<string, unknown>
        | undefined
    )?.component as Record<string, unknown> | undefined
  )?.target as Record<string, unknown> | undefined;
  const targetDeps = componentTargetDeps?.dependencies as
    | Record<string, unknown>
    | undefined;
  if (targetDeps) {
    for (const depKey of Object.keys(targetDeps)) {
      pushTomlQuotedKeyInSection(
        occurrences,
        pluginTomlPath,
        pluginContent,
        "[package.metadata.component.target.dependencies]",
        depKey,
        "external_plugin",
        `external_plugin:${serviceKey}:${depKey}`,
        { inlayInline: true },
      );
    }
  }

  const componentPackage = (
    (
      (pluginToml.package as Record<string, unknown> | undefined)?.metadata as
        | Record<string, unknown>
        | undefined
    )?.component as Record<string, unknown> | undefined
  )?.package as string | undefined;
  if (componentPackage) {
    pushTomlString(
      occurrences,
      pluginTomlPath,
      pluginContent,
      "wit_package",
      `wit_package:${serviceKey}`,
      componentPackage,
      ["package"],
    );
  }

  const witDir = path.join(pluginDir, "wit");
  if (fs.existsSync(witDir)) {
    for (const entry of fs.readdirSync(witDir)) {
      if (entry.endsWith(".wit")) {
        scanWitPackage(occurrences, path.join(witDir, entry), serviceKey, overrides);
      }
    }
  }
}

function scanWitPackage(
  occurrences: Occurrence[],
  witPath: string,
  serviceKey: string,
  overrides?: ContentOverrides,
): void {
  const content = readContent(witPath, overrides);
  const re = /^\s*package\s+([^;]+);/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const value = match[1].trim();
    const before = content.slice(0, match.index);
    const line = before.split("\n").length;
    const lineStart = content.lastIndexOf("\n", match.index) + 1;
    const valueStart = content.indexOf(value, match.index);
    occurrences.push({
      entity: "wit_package",
      groupId: `wit_package:${serviceKey}`,
      value,
      location: {
        file: witPath,
        line,
        startCol: valueStart - lineStart,
        endCol: valueStart - lineStart + value.length,
      },
    });
  }
}

function scanRustServiceAccount(
  occurrences: Occurrence[],
  serviceDir: string,
  serviceKey: string,
  overrides?: ContentOverrides,
): void {
  scanRustDir(
    occurrences,
    path.join(serviceDir, "src"),
    "on_chain_service",
    `on_chain_service:${serviceKey}`,
    overrides,
  );
}

function scanRustQueryAccount(
  occurrences: Occurrence[],
  queryDir: string,
  serviceKey: string,
  overrides?: ContentOverrides,
): void {
  scanRustDir(
    occurrences,
    path.join(queryDir, "src"),
    "on_chain_query",
    `on_chain_query:${serviceKey}`,
    overrides,
  );
}

function scanRustDir(
  occurrences: Occurrence[],
  dir: string,
  entity: EntityType,
  groupId: string,
  overrides?: ContentOverrides,
): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanRustDir(occurrences, full, entity, groupId, overrides);
    } else if (entry.name.endsWith(".rs")) {
      const content = readContent(full, overrides);
      const re = /#\[psibase::service\s*\(\s*name\s*=\s*"([^"]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        const value = match[1];
        const before = content.slice(0, match.index);
        const line = before.split("\n").length;
        const lineStart = content.lastIndexOf("\n", match.index) + 1;
        const quoted = `"${value}"`;
        const quoteStart = content.indexOf(quoted, match.index);
        occurrences.push({
          entity,
          groupId,
          value,
          location: {
            file: full,
            line,
            startCol: quoteStart - lineStart + 1,
            endCol: quoteStart - lineStart + 1 + value.length,
          },
        });
      }
    }
  }
}

function scanCmakeOutputs(
  occurrences: Occurrence[],
  packageRoot: string,
  cmakeSearchRoots: string[],
  overrides?: ContentOverrides,
): void {
  const canonicalRoot = fs.realpathSync(packageRoot);

  for (const searchRoot of cmakeSearchRoots) {
    const cmakePath = path.join(searchRoot, "CMakeLists.txt");
    if (!fs.existsSync(cmakePath)) continue;

    const content = readContent(cmakePath, overrides);
    const blockRe =
      /cargo_psibase_package\s*\([\s\S]*?PATH\s+([^\)\n]+)[\s\S]*?\)/g;
    let match: RegExpExecArray | null;
    while ((match = blockRe.exec(content)) !== null) {
      const pathValue = match[1].trim();
      if (!pathMatchesPackage(pathValue, canonicalRoot, searchRoot)) continue;
      const block = match[0];
      const outputRe = /OUTPUT\s+\$\{SERVICE_DIR\}\/([^.]+)\.psi/;
      const out = block.match(outputRe);
      if (!out) continue;
      const psiName = out[1];
      const loc = findWordInContent(cmakePath, content, psiName);
      if (loc) {
        occurrences.push({
          entity: "published_package",
          groupId: "published_package",
          value: psiName,
          location: loc,
        });
      }
    }
  }
}

function pathMatchesPackage(
  pathValue: string,
  packageRoot: string,
  searchRoot: string,
): boolean {
  const rel = path.relative(searchRoot, packageRoot).replace(/\\/g, "/");
  const normalized = pathValue.replace(/\\/g, "/");
  return (
    normalized.endsWith(rel) || normalized.endsWith(path.basename(packageRoot))
  );
}

function dependencyPath(
  deps: Record<string, unknown>,
  key: string,
  base: string,
): string | undefined {
  const dep = deps[key] as Record<string, unknown> | undefined;
  const depPath = dep?.path as string | undefined;
  return depPath ? path.join(base, depPath) : undefined;
}

function pushTomlFieldString(
  occurrences: Occurrence[],
  filePath: string,
  content: string,
  entity: EntityType,
  groupId: string,
  field: string,
  value: string,
  keyHints: string[],
): void {
  const loc = findTomlFieldStringValue(
    filePath,
    content,
    field,
    value,
    keyHints,
  );
  if (loc) {
    occurrences.push({ entity, groupId, value, location: loc });
  }
}

function findTomlFieldStringValue(
  filePath: string,
  content: string,
  field: string,
  value: string,
  keyHints: string[],
): Location | undefined {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fieldRe = new RegExp(`${escapedField}\\s*=\\s*"${escapedValue}"`);
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!keyHints.some((k) => line.includes(k))) continue;
    const match = fieldRe.exec(line);
    if (!match) continue;
    const startCol = match.index + match[0].length - 1 - value.length;
    return {
      file: filePath,
      line: i + 1,
      startCol,
      endCol: startCol + value.length,
    };
  }
  return undefined;
}

function pushTomlString(
  occurrences: Occurrence[],
  filePath: string,
  content: string,
  entity: EntityType,
  groupId: string,
  value: string,
  keyHints: string[],
  options?: { inlayPlural?: boolean },
): void {
  const loc = findTomlStringValue(filePath, content, value, keyHints);
  if (loc) {
    occurrences.push({
      entity,
      groupId,
      value,
      location: loc,
      inlayPlural: options?.inlayPlural,
    });
  }
}

function pushTomlKey(
  occurrences: Occurrence[],
  filePath: string,
  content: string,
  entity: EntityType,
  groupId: string,
  value: string,
  options?: { inlayInline?: boolean },
): void {
  const loc = findTomlTableKey(filePath, content, value);
  if (loc) {
    occurrences.push({
      entity,
      groupId,
      value,
      location: loc,
      inlayInline: options?.inlayInline ?? false,
    });
  }
}

function pushTomlQuotedKeyInSection(
  occurrences: Occurrence[],
  filePath: string,
  content: string,
  sectionHeader: string,
  key: string,
  entity: EntityType,
  groupId: string,
  options?: { inlayInline?: boolean },
): void {
  const loc = findTomlQuotedTableKeyInSection(
    filePath,
    content,
    sectionHeader,
    key,
  );
  if (loc) {
    occurrences.push({
      entity,
      groupId,
      value: key,
      location: loc,
      inlayInline: options?.inlayInline ?? false,
    });
  }
}

function findTomlQuotedTableKeyInSection(
  filePath: string,
  content: string,
  sectionHeader: string,
  key: string,
): Location | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyRe = new RegExp(`^\\s*"${escapedKey}"\\s*=`);
  const lines = content.split("\n");
  let inSection = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inSection = trimmed === sectionHeader;
      continue;
    }
    if (!inSection) continue;

    const match = keyRe.exec(lines[i]);
    if (!match || match.index === undefined) continue;
    const keyStart = lines[i].indexOf(key, match.index);
    if (keyStart < 0) continue;
    return {
      file: filePath,
      line: i + 1,
      startCol: keyStart,
      endCol: keyStart + key.length,
    };
  }
  return undefined;
}

function findTomlStringValue(
  filePath: string,
  content: string,
  value: string,
  keyHints: string[],
): Location | undefined {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!keyHints.some((k) => line.includes(k))) continue;
    const loc = findExactQuotedInLine(filePath, line, i + 1, value);
    if (loc) return loc;
  }
  for (let i = 0; i < lines.length; i++) {
    const loc = findExactQuotedInLine(filePath, lines[i], i + 1, value);
    if (loc) return loc;
  }
  return undefined;
}

function findExactQuotedInLine(
  filePath: string,
  line: string,
  lineNum: number,
  value: string,
): Location | undefined {
  const prefix = `"${value}`;
  let idx = 0;
  while (idx < line.length) {
    const start = line.indexOf(prefix, idx);
    if (start < 0) return undefined;
    const closeIdx = start + 1 + value.length;
    if (line[closeIdx] === '"') {
      return {
        file: filePath,
        line: lineNum,
        startCol: start + 1,
        endCol: start + 1 + value.length,
      };
    }
    idx = start + 1;
  }
  return undefined;
}

function findTomlTableKey(
  filePath: string,
  content: string,
  key: string,
): Location | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyRe = new RegExp(`^\\s*${escaped}\\s*=`, "m");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = keyRe.exec(lines[i]);
    if (!match || match.index === undefined) continue;
    const start =
      match.index + lines[i].slice(match.index).indexOf(key);
    return {
      file: filePath,
      line: i + 1,
      startCol: start,
      endCol: start + key.length,
    };
  }
  return undefined;
}

function findWordInContent(
  filePath: string,
  content: string,
  word: string,
): Location | undefined {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const start = lines[i].indexOf(word);
    if (start >= 0) {
      return {
        file: filePath,
        line: i + 1,
        startCol: start,
        endCol: start + word.length,
      };
    }
  }
  return undefined;
}

export function findPackageRoots(startDir: string): string[] {
  const roots: string[] = [];
  const queue = [startDir];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const dir = queue.pop()!;
    if (seen.has(dir)) continue;
    seen.add(dir);

    const cargo = path.join(dir, "Cargo.toml");
    if (fs.existsSync(cargo)) {
      try {
        const toml = TOML.parse(fs.readFileSync(cargo, "utf8")) as Record<
          string,
          unknown
        >;
        const psibase = (
          (toml.package as Record<string, unknown> | undefined)?.metadata as
            | Record<string, unknown>
            | undefined
        )?.psibase as Record<string, unknown> | undefined;
        if (psibase?.["package-name"]) {
          roots.push(dir);
          continue;
        }
      } catch {
        // ignore parse errors during discovery
      }
    }

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (
        entry.name === "node_modules" ||
        entry.name === "target" ||
        entry.name === "build" ||
        entry.name === ".git"
      ) {
        continue;
      }
      queue.push(path.join(dir, entry.name));
    }
  }

  return roots;
}

export function cmakeSearchRoots(packageRoot: string): string[] {
  const roots: string[] = [];
  let current = packageRoot;
  while (true) {
    if (fs.existsSync(path.join(current, "CMakeLists.txt"))) {
      roots.push(current);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}

export function occurrenceAt(
  scan: PackageScan,
  file: string,
  line: number,
  col: number,
): Occurrence | undefined {
  return scan.occurrences.find(
    (occ) =>
      path.normalize(occ.location.file) === path.normalize(file) &&
      occ.location.line === line &&
      col >= occ.location.startCol &&
      col <= occ.location.endCol,
  );
}

export function groupOccurrences(
  scan: PackageScan,
  groupId: string,
): Occurrence[] {
  return scan.occurrences.filter((o) => o.groupId === groupId);
}
