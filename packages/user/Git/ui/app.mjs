import { getSupervisor, postJsonGetJson } from "/common/common-lib.js";
import { fetchLoose, mergeBranches } from "./merge.mjs";

const $ = (id) => document.getElementById(id);
const supervisor = getSupervisor();

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

async function currentUser() {
  return supervisor.functionCall({
    service: "host",
    plugin: "accounts",
    intf: "api",
    method: "getCurrentUser",
    params: [],
  });
}

async function refreshUser() {
  const user = await currentUser();
  const label = $("user-label");
  const btn = $("login");
  if (user) {
    label.textContent = user;
    btn.textContent = "Logout";
  } else {
    label.textContent = "Not logged in";
    btn.textContent = "Login";
  }
  return user;
}

async function toggleLogin() {
  const user = await currentUser();
  if (user) {
    await supervisor.functionCall({
      service: "host",
      plugin: "accounts",
      intf: "activeApp",
      method: "logout",
      params: [],
    });
  } else {
    await supervisor.functionCall(
      {
        service: "host",
        plugin: "accounts",
        intf: "activeApp",
        method: "connectAccount",
        params: [],
      },
      { enabled: true, returnPath: "/" },
    );
  }
  await refreshUser();
}

async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error("Login required");
  return user;
}

async function callGit(method, params) {
  await requireUser();
  return supervisor.functionCall({
    service: "git",
    plugin: "plugin",
    intf: "api",
    method,
    params,
  });
}

async function loadRepos() {
  const data = await gql(`{ repos { owner name defaultBranch } }`);
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
    for (const sel of [base, source]) {
      const opt = document.createElement("option");
      opt.value = r.refname;
      opt.textContent = r.refname.replace(/^refs\/heads\//, "");
      sel.appendChild(opt);
    }
  }
  const main = heads.find((r) => r.refname === "refs/heads/main");
  if (main) base.value = main.refname;
  else if (heads[0]) base.value = heads[0].refname;
  const sourceHead = heads.find((r) => r.refname !== base.value);
  if (sourceHead) source.value = sourceHead.refname;

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
  await callGit("openPr", [repo.owner, repo.name, source, base]);
  setStatus("PR opened.");
  await loadRefsAndPrs();
}

async function doClose(pr) {
  const repo = selectedRepo();
  setStatus(`Closing PR #${pr.id}…`);
  await callGit("closePr", [repo.owner, repo.name, pr.id]);
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
  const byRef = Object.fromEntries(
    (data.refs || []).map((r) => [r.refname, r.oid]),
  );
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

  const toPut = [];
  for (const o of objects) {
    try {
      await fetchLoose(repo.owner, repo.name, o.oid);
    } catch {
      toPut.push({ oid: o.oid, data: Array.from(o.zlib) });
    }
  }

  await callGit("mergePr", [
    repo.owner,
    repo.name,
    pr.id,
    toPut,
    [{ refname: pr.base, oldOid: baseOid, newOid: mergeOid }],
  ]);
  setStatus(`Merged PR #${pr.id} → ${mergeOid.slice(0, 12)}`);
  await loadRefsAndPrs();
}

async function refresh() {
  setStatus("Loading…");
  await refreshUser();
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

$("login").addEventListener("click", () => toggleLogin().catch(showErr));
$("refresh").addEventListener("click", () => refresh().catch(showErr));
$("repo").addEventListener("change", () => loadRefsAndPrs().catch(showErr));
$("open-form").addEventListener("submit", (ev) => doOpen(ev).catch(showErr));

refresh().catch(showErr);
