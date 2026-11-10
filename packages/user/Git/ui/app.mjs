import {
  getTaposForHeadBlock,
  packSignedTransaction,
  postArrayBufferGetJson,
  postJsonGetJson,
  siblingUrl,
  signTransaction,
} from "/common/common-lib.js";
import { fetchLoose, mergeBranches, toHex } from "./merge.mjs";

const $ = (id) => document.getElementById(id);

function installCommand() {
  const { protocol, host } = window.location;
  const protoFlag =
    protocol === "https:" ? " --proto '=https' --tlsv1.2" : "";
  return `curl${protoFlag} -fsSL ${protocol}//${host}/install.sh | sh`;
}

function setStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg || "";
  el.classList.toggle("error", !!isError);
}

function account() {
  return $("account").value.trim();
}

function privateKey() {
  return $("key").value.trim();
}

function authorLine() {
  const v = $("author").value.trim();
  return v || "psibase-git-ui <git-ui@psibase.local>";
}

function selectedRepo() {
  const v = $("repo").value;
  if (!v) return null;
  const i = v.indexOf("/");
  return { owner: v.slice(0, i), name: v.slice(i + 1) };
}

async function gql(query, variables) {
  const res = await postJsonGetJson("/graphql", { query, variables });
  if (res.errors?.length) {
    throw new Error(res.errors.map((e) => e.message).join("; "));
  }
  return res.data;
}

function rootUrl() {
  const root = window.location.hostname.replace(/^git\./, "");
  return `${window.location.protocol}//${root}${
    window.location.port ? ":" + window.location.port : ""
  }`;
}

async function pushActions(actions) {
  const base = rootUrl();
  const sender = account();
  const key = privateKey();
  if (!sender) throw new Error("account required");
  if (!key) throw new Error("private key required");
  const transaction = {
    tapos: {
      ...(await getTaposForHeadBlock(base)),
      expiration: new Date(Date.now() + 30_000),
    },
    actions: actions.map((a) => ({
      sender,
      service: "git",
      ...a,
    })),
  };
  const signed = await signTransaction(base, transaction, [key]);
  const packed = await packSignedTransaction(base, signed);
  const url = siblingUrl(base, "transact", "/push_transaction?wait_for=applied");
  const trace = await postArrayBufferGetJson(url, packed);
  if (trace.error) throw new Error(trace.error);
  return trace;
}

async function loadRepos() {
  const data = await gql(`{ repos { owner name default_branch } }`);
  const repos = data.repos || [];
  const sel = $("repo");
  const prev = sel.value;
  sel.innerHTML = "";
  for (const r of repos) {
    const opt = document.createElement("option");
    opt.value = `${r.owner}/${r.name}`;
    opt.textContent = `${r.owner}/${r.name}`;
    sel.appendChild(opt);
  }
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  if (!sel.value && sel.options.length) sel.selectedIndex = 0;
}

async function loadRefsAndPrs() {
  const repo = selectedRepo();
  const source = $("source");
  const base = $("base");
  const list = $("pr-list");
  source.innerHTML = "";
  base.innerHTML = "";
  list.innerHTML = "";
  if (!repo) return;

  const data = await gql(`{
      refs(owner: "${repo.owner}", name: "${repo.name}") { refname oid }
      prs(owner: "${repo.owner}", name: "${repo.name}") { id source base opener }
    }`);
  const heads = (data.refs || []).filter((r) =>
    r.refname.startsWith("refs/heads/"),
  );
  for (const r of heads) {
    for (const sel of [source, base]) {
      const opt = document.createElement("option");
      opt.value = r.refname;
      opt.textContent = r.refname.replace(/^refs\/heads\//, "");
      sel.appendChild(opt);
    }
  }
  if (heads.length >= 2) {
    base.value = heads[0].refname;
    source.value = heads[1].refname;
  }

  for (const pr of data.prs || []) {
    const li = document.createElement("li");
    const meta = document.createElement("div");
    meta.className = "pr-meta";
    meta.textContent = `#${pr.id}  ${pr.source.replace(/^refs\/heads\//, "")} → ${pr.base.replace(/^refs\/heads\//, "")}  (opener ${pr.opener})`;
    const actions = document.createElement("div");
    actions.className = "pr-actions";
    const mergeBtn = document.createElement("button");
    mergeBtn.type = "button";
    mergeBtn.className = "primary";
    mergeBtn.textContent = "Merge";
    mergeBtn.addEventListener("click", () => doMerge(pr).catch(showErr));
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "danger";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => doClose(pr).catch(showErr));
    actions.append(mergeBtn, closeBtn);
    li.append(meta, actions);
    list.appendChild(li);
  }
}

function showErr(e) {
  console.error(e);
  setStatus(e.message || String(e), true);
}

async function doOpen(ev) {
  ev.preventDefault();
  const repo = selectedRepo();
  if (!repo) throw new Error("select a repo");
  const source = $("source").value;
  const base = $("base").value;
  setStatus("Opening PR…");
  await pushActions([
    {
      method: "openPr",
      data: { owner: repo.owner, name: repo.name, source, base },
    },
  ]);
  setStatus("PR opened.");
  await loadRefsAndPrs();
}

async function doClose(pr) {
  const repo = selectedRepo();
  setStatus(`Closing PR #${pr.id}…`);
  await pushActions([
    {
      method: "closePr",
      data: { owner: repo.owner, name: repo.name, id: pr.id },
    },
  ]);
  setStatus(`Closed PR #${pr.id}.`);
  await loadRefsAndPrs();
}

async function doMerge(pr) {
  const repo = selectedRepo();
  if (!repo) throw new Error("select a repo");
  setStatus(`Merging PR #${pr.id}…`);

  const data = await gql(`{
      refs(owner: "${repo.owner}", name: "${repo.name}") { refname oid }
    }`);
  const byRef = Object.fromEntries((data.refs || []).map((r) => [r.refname, r.oid]));
  const baseOid = byRef[pr.base];
  const sourceOid = byRef[pr.source];
  if (!baseOid || !sourceOid) throw new Error("source or base ref missing");

  const cache = new Map();
  const fetchObj = async (oid) => {
    if (cache.has(oid)) return cache.get(oid);
    const obj = await fetchLoose(repo.owner, repo.name, oid);
    cache.set(oid, obj);
    return obj;
  };

  const message = `Merge ${pr.source} into ${pr.base}`;
  const { mergeOid, objects } = await mergeBranches(
    fetchObj,
    baseOid,
    sourceOid,
    authorLine(),
    message,
  );

  // Skip objects already on chain (decodeLoose oid matches).
  const toPut = [];
  for (const o of objects) {
    try {
      await fetchLoose(repo.owner, repo.name, o.oid);
    } catch {
      toPut.push(o);
    }
  }

  const actions = [];
  if (toPut.length) {
    actions.push({
      method: "putObjects",
      data: {
        owner: repo.owner,
        name: repo.name,
        objects: toPut.map((o) => ({
          oid: o.oid,
          data: toHex(o.zlib),
        })),
      },
    });
  }
  actions.push({
    method: "updateRefs",
    data: {
      owner: repo.owner,
      name: repo.name,
      updates: [
        {
          refname: pr.base,
          old_oid: baseOid,
          new_oid: mergeOid,
        },
      ],
    },
  });
  actions.push({
    method: "closePr",
    data: { owner: repo.owner, name: repo.name, id: pr.id },
  });

  await pushActions(actions);
  setStatus(`Merged PR #${pr.id} → ${mergeOid.slice(0, 12)}`);
  await loadRefsAndPrs();
}

async function refresh() {
  setStatus("Loading…");
  await loadRepos();
  await loadRefsAndPrs();
  setStatus("");
}

$("install-cmd").value = installCommand();
$("install-sh-link").href = `${window.location.protocol}//${window.location.host}/install.sh`;

$("copy-install").addEventListener("click", async () => {
  const cmd = $("install-cmd");
  cmd.select();
  try {
    await navigator.clipboard.writeText(cmd.value);
    setStatus("Install command copied.");
  } catch {
    setStatus("Select and copy the install command manually.");
  }
});

$("refresh").addEventListener("click", () => refresh().catch(showErr));
$("repo").addEventListener("change", () => loadRefsAndPrs().catch(showErr));
$("open-form").addEventListener("submit", (ev) => doOpen(ev).catch(showErr));

refresh().catch(showErr);
