/** Client-side loose-object helpers for the POC merge UI. */

const te = new TextEncoder();
const td = new TextDecoder();

export function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function sha1(bytes) {
  const dig = await crypto.subtle.digest("SHA-1", bytes);
  return toHex(new Uint8Array(dig));
}

async function inflate(zlibBytes) {
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([zlibBytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflate(raw) {
  const cs = new CompressionStream("deflate");
  const stream = new Blob([raw]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** @returns {{ oid: string, kind: string, content: Uint8Array, zlib: Uint8Array }} */
export async function decodeLoose(zlibBytes) {
  const raw = await inflate(zlibBytes);
  const nul = raw.indexOf(0);
  if (nul < 0) throw new Error("bad object header");
  const header = td.decode(raw.subarray(0, nul));
  const [kind, sizeStr] = header.split(" ");
  const content = raw.subarray(nul + 1);
  if (content.length !== Number(sizeStr)) throw new Error("object size mismatch");
  const oid = await sha1(raw);
  return { oid, kind, content, zlib: zlibBytes };
}

export async function encodeLoose(kind, content) {
  const header = te.encode(`${kind} ${content.length}\0`);
  const raw = new Uint8Array(header.length + content.length);
  raw.set(header, 0);
  raw.set(content, header.length);
  const oid = await sha1(raw);
  const zlib = await deflate(raw);
  return { oid, kind, content, zlib };
}

function headerLines(content) {
  const text = td.decode(content);
  const lines = [];
  for (const line of text.split("\n")) {
    if (line === "") break;
    lines.push(line);
  }
  return lines;
}

export function commitTree(content) {
  for (const line of headerLines(content)) {
    if (line.startsWith("tree ")) return line.slice(5);
  }
  return null;
}

export function commitParents(content) {
  return headerLines(content)
    .filter((l) => l.startsWith("parent "))
    .map((l) => l.slice(7));
}

/** @returns {{ mode: string, name: string, oid: string }[]} */
export function parseTree(content) {
  const entries = [];
  let i = 0;
  while (i < content.length) {
    let sp = i;
    while (sp < content.length && content[sp] !== 0x20) sp++;
    const mode = td.decode(content.subarray(i, sp));
    let nul = sp + 1;
    while (nul < content.length && content[nul] !== 0) nul++;
    const name = td.decode(content.subarray(sp + 1, nul));
    const oidBytes = content.subarray(nul + 1, nul + 21);
    entries.push({ mode, name, oid: toHex(oidBytes) });
    i = nul + 21;
  }
  return entries;
}

export function buildTree(entries) {
  // git sorts by name with a trailing slash for trees (mode 40000).
  const sorted = [...entries].sort((a, b) => {
    const an = a.mode === "40000" ? a.name + "/" : a.name;
    const bn = b.mode === "40000" ? b.name + "/" : b.name;
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
  const parts = [];
  for (const e of sorted) {
    const head = te.encode(`${e.mode} ${e.name}\0`);
    const oid = fromHex(e.oid);
    const chunk = new Uint8Array(head.length + 20);
    chunk.set(head, 0);
    chunk.set(oid, head.length);
    parts.push(chunk);
  }
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function buildCommit({ tree, parents, author, committer, message }) {
  const lines = [`tree ${tree}`, ...parents.map((p) => `parent ${p}`)];
  lines.push(`author ${author}`, `committer ${committer}`, "", message, "");
  return te.encode(lines.join("\n"));
}
