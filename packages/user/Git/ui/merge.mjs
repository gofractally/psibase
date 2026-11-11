import {
  buildCommit,
  buildTree,
  commitParents,
  commitTree,
  decodeLoose,
  encodeLoose,
  parseTree,
  toHex,
} from "./gitobj.mjs";

/**
 * @param {(oid: string) => Promise<{ oid: string, kind: string, content: Uint8Array, zlib: Uint8Array }>} fetchObj
 */
export async function flattenTree(fetchObj, treeOid, prefix = "") {
  const map = new Map(); // path -> { mode, oid }
  const tree = await fetchObj(treeOid);
  if (tree.kind !== "tree") throw new Error(`expected tree ${treeOid}`);
  for (const e of parseTree(tree.content)) {
    const path = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.mode === "40000") {
      const sub = await flattenTree(fetchObj, e.oid, path);
      for (const [p, v] of sub) map.set(p, v);
    } else if (e.mode === "160000") {
      // gitlink: treat as opaque blob-like entry
      map.set(path, { mode: e.mode, oid: e.oid });
    } else {
      map.set(path, { mode: e.mode, oid: e.oid });
    }
  }
  return map;
}

/**
 * Best common ancestor via interleaved BFS from both tips.
 * Stops at the first commit reachable from both; does not preload either side's
 * full history (needed when the on-chain object store is incomplete).
 */
export async function mergeBase(fetchObj, a, b) {
  if (a === b) return a;
  const fromA = new Set([a]);
  const fromB = new Set([b]);
  const qa = [a];
  const qb = [b];

  async function expand(queue, mine, other) {
    if (!queue.length) return null;
    const c = queue.shift();
    const obj = await fetchObj(c);
    if (obj.kind !== "commit") return null;
    for (const p of commitParents(obj.content)) {
      if (other.has(p)) return p;
      if (!mine.has(p)) {
        mine.add(p);
        queue.push(p);
      }
    }
    return null;
  }

  while (qa.length || qb.length) {
    const hit =
      (await expand(qa, fromA, fromB)) || (await expand(qb, fromB, fromA));
    if (hit) return hit;
  }
  return null;
}

/**
 * Three-way path merge. Returns { paths: Map, conflicts: string[] }.
 * Blobs compared by oid only.
 */
export function threeWayPaths(base, ours, theirs) {
  const keys = new Set([...base.keys(), ...ours.keys(), ...theirs.keys()]);
  const out = new Map();
  const conflicts = [];
  for (const path of keys) {
    const b = base.get(path);
    const o = ours.get(path);
    const t = theirs.get(path);
    const same = (x, y) =>
      (!x && !y) || (x && y && x.mode === y.mode && x.oid === y.oid);
    if (same(o, t)) {
      if (o) out.set(path, o);
      continue;
    }
    if (same(b, o) && t) {
      out.set(path, t);
      continue;
    }
    if (same(b, t) && o) {
      out.set(path, o);
      continue;
    }
    if (same(b, o) && !t) continue; // deleted on theirs
    if (same(b, t) && !o) continue; // deleted on ours
    conflicts.push(path);
  }
  return { paths: out, conflicts };
}

/** Rebuild nested trees from a flat path map. Returns root tree oid + new objects. */
export async function buildTreeFromPaths(pathMap) {
  // nest: dirPath -> Map(name -> { mode, oid } | nested)
  const root = { dirs: new Map(), files: new Map() };

  function ensureDir(parts) {
    let node = root;
    for (const p of parts) {
      if (!node.dirs.has(p)) node.dirs.set(p, { dirs: new Map(), files: new Map() });
      node = node.dirs.get(p);
    }
    return node;
  }

  for (const [path, ent] of pathMap) {
    const parts = path.split("/");
    const name = parts.pop();
    const dir = ensureDir(parts);
    dir.files.set(name, ent);
  }

  const newObjects = []; // { oid, zlib }

  async function writeNode(node) {
    const entries = [];
    for (const [name, child] of node.dirs) {
      const oid = await writeNode(child);
      entries.push({ mode: "40000", name, oid });
    }
    for (const [name, ent] of node.files) {
      entries.push({ mode: ent.mode, name, oid: ent.oid });
    }
    const content = buildTree(entries);
    const enc = await encodeLoose("tree", content);
    newObjects.push({ oid: enc.oid, zlib: enc.zlib });
    return enc.oid;
  }

  const rootOid = await writeNode(root);
  return { rootOid, newObjects };
}

/**
 * Merge source into base. Returns { mergeOid, objects } or throws on conflict.
 * objects is [{ oid, zlib }] for new trees/commit only.
 */
export async function mergeBranches(
  fetchObj,
  baseOid,
  sourceOid,
  authorLine,
  message,
) {
  const baseCommit = await fetchObj(baseOid);
  const sourceCommit = await fetchObj(sourceOid);
  if (baseCommit.kind !== "commit" || sourceCommit.kind !== "commit") {
    throw new Error("tips must be commits");
  }
  const baseTree = commitTree(baseCommit.content);
  const sourceTree = commitTree(sourceCommit.content);
  const mb = await mergeBase(fetchObj, baseOid, sourceOid);
  if (!mb) throw new Error("no common ancestor");
  const mbCommit = await fetchObj(mb);
  const mbTree = commitTree(mbCommit.content);

  const basePaths = await flattenTree(fetchObj, baseTree);
  const sourcePaths = await flattenTree(fetchObj, sourceTree);
  const mbPaths = await flattenTree(fetchObj, mbTree);

  const { paths, conflicts } = threeWayPaths(mbPaths, basePaths, sourcePaths);
  if (conflicts.length) {
    const err = new Error(
      `merge conflicts (resolve locally and push):\n${conflicts.join("\n")}`,
    );
    err.conflicts = conflicts;
    throw err;
  }

  const { rootOid, newObjects } = await buildTreeFromPaths(paths);
  const now = Math.floor(Date.now() / 1000);
  const ident = `${authorLine} ${now} +0000`;
  const content = buildCommit({
    tree: rootOid,
    parents: [baseOid, sourceOid],
    author: ident,
    committer: ident,
    message,
  });
  const commit = await encodeLoose("commit", content);
  newObjects.push({ oid: commit.oid, zlib: commit.zlib });
  return { mergeOid: commit.oid, objects: newObjects };
}

export function objectUrl(owner, repo, oid) {
  return `/${owner}/${repo}.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
}

export async function fetchLoose(owner, repo, oid) {
  const res = await fetch(objectUrl(owner, repo, oid));
  if (!res.ok) throw new Error(`missing object ${oid}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return decodeLoose(buf);
}

export { toHex };
