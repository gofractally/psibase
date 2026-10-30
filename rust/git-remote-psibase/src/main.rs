//! `git-remote-psibase`: git remote helper for the psibase `git` service.
//!
//! Git runs `git-remote-psibase <remote> <url>` for remotes whose URL is
//! `psibase::<url>`, where `<url>` is `http(s)://<root>/<owner>/<repo>[.git]`.
//! Reads use the service's dumb HTTP interface on `git.<root>`. Pushes sign
//! `putObjects` / `updateRefs` transactions and post them to
//! `transact.<root>/push_transaction`.
//!
//! Account and key, first match wins:
//! 1. `PSIBASE_GIT_ACCOUNT` / `PSIBASE_GIT_KEY` environment variables
//! 2. git config `psibase.account` / `psibase.key`
//! 3. `~/.psibase.toml` section `[git.<name>]`, where `<name>` is the
//!    `[hosts]` alias whose URL matches the remote's root URL, or the
//!    remote's `host[:port]`
//! The account defaults to the repo owner. The key is a PEM/DER private key
//! file or a PKCS #11 URI, exactly as `psibase push --sign` accepts.

use anyhow::{anyhow, bail, Context, Result};
use fracpack::{Pack, Unpack};
use psibase::{
    get_tapos_for_head, sign_transaction, AccountNumber, Action, AnyPrivateKey, ChainUrl,
    MethodNumber, Seconds, Tapos, TimePointSec, Transaction, TransactionTrace,
};
use std::collections::{BTreeMap, HashSet, VecDeque};
use std::io::{BufRead, Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::str::FromStr;
use url::Url;

const ZERO_OID: &str = "0000000000000000000000000000000000000000";
const MAX_OBJECT_SIZE: usize = 1024 * 1024;
/// Keep each transaction well under the 8 MiB soft block budget.
const MAX_TX_BYTES: usize = 3 * 1024 * 1024;

#[derive(Pack)]
#[fracpack(fracpack_mod = "fracpack")]
struct GitObject {
    oid: String,
    data: Vec<u8>,
}

#[derive(Pack)]
#[fracpack(fracpack_mod = "fracpack")]
struct PutObjects {
    owner: AccountNumber,
    name: String,
    objects: Vec<GitObject>,
}

#[derive(Pack)]
#[fracpack(fracpack_mod = "fracpack")]
struct RefUpdate {
    refname: String,
    old_oid: String,
    new_oid: String,
}

#[derive(Pack)]
#[fracpack(fracpack_mod = "fracpack")]
struct UpdateRefs {
    owner: AccountNumber,
    name: String,
    updates: Vec<RefUpdate>,
}

struct Remote {
    root: Url,
    owner: AccountNumber,
    repo: String,
    client: reqwest::Client,
}

fn parse_url(raw: &str) -> Result<(Url, AccountNumber, String)> {
    let url = Url::parse(raw.strip_prefix("psibase::").unwrap_or(raw))
        .with_context(|| format!("bad remote url {raw}"))?;
    let segs: Vec<&str> = url
        .path_segments()
        .map(|s| s.filter(|p| !p.is_empty()).collect())
        .unwrap_or_default();
    let [owner, repo] = segs[..] else {
        bail!("remote url must be <root>/<owner>/<repo>");
    };
    let owner = AccountNumber::from_str(owner).map_err(|e| anyhow!("bad owner: {e}"))?;
    let repo = repo.strip_suffix(".git").unwrap_or(repo).to_string();
    let mut root = url.clone();
    root.set_path("/");
    root.set_query(None);
    Ok((root, owner, repo))
}

impl Remote {
    fn repo_url(&self, rest: &str) -> Result<Url> {
        let base = psibase::account!("git").url(&self.root)?;
        Ok(base.join(&format!("/{}/{}.git/{}", self.owner, self.repo, rest))?)
    }

    async fn get(&self, rest: &str) -> Result<Option<Vec<u8>>> {
        let resp = self.client.get(self.repo_url(rest)?).send().await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !resp.status().is_success() {
            bail!("GET {rest}: HTTP {}", resp.status());
        }
        Ok(Some(resp.bytes().await?.to_vec()))
    }

    /// Returns (refs, head symref). Errors if the repo does not exist.
    async fn list(&self) -> Result<(BTreeMap<String, String>, Option<String>)> {
        let body = self
            .get("info/refs")
            .await?
            .ok_or_else(|| anyhow!("repo {}/{} does not exist", self.owner, self.repo))?;
        let mut refs = BTreeMap::new();
        for line in String::from_utf8(body)?.lines() {
            if let Some((oid, name)) = line.split_once('\t') {
                if !name.ends_with("^{}") {
                    refs.insert(name.to_string(), oid.to_string());
                }
            }
        }
        let head = self
            .get("HEAD")
            .await?
            .and_then(|b| String::from_utf8(b).ok())
            .and_then(|s| s.trim().strip_prefix("ref: ").map(str::to_string));
        Ok((refs, head))
    }
}

// ---------------------------------------------------------------- config

struct Signer {
    account: AccountNumber,
    key: Option<String>,
}

fn git_config(key: &str) -> Option<String> {
    let out = Command::new("git")
        .args(["config", "--get", key])
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

fn psibase_toml() -> Option<toml::Value> {
    let home = std::env::var_os("HOME")?;
    let s = std::fs::read_to_string(PathBuf::from(home).join(".psibase.toml")).ok()?;
    toml::from_str(&s).ok()
}

fn signer(remote: &Remote) -> Result<Signer> {
    let mut account = std::env::var("PSIBASE_GIT_ACCOUNT")
        .ok()
        .filter(|s| !s.is_empty());
    let mut key = std::env::var("PSIBASE_GIT_KEY")
        .ok()
        .filter(|s| !s.is_empty());
    account = account.or_else(|| git_config("psibase.account"));
    key = key.or_else(|| git_config("psibase.key"));
    if account.is_none() || key.is_none() {
        if let Some(cfg) = psibase_toml() {
            let root = remote.root.as_str().trim_end_matches('/');
            let mut names: Vec<String> = cfg
                .get("hosts")
                .and_then(|h| h.as_table())
                .into_iter()
                .flatten()
                .filter(|(_, v)| v.as_str().map(|u| u.trim_end_matches('/')) == Some(root))
                .map(|(k, _)| k.clone())
                .collect();
            let hostport = match remote.root.port() {
                Some(p) => format!("{}:{}", remote.root.host_str().unwrap_or(""), p),
                None => remote.root.host_str().unwrap_or("").to_string(),
            };
            names.push(hostport);
            for n in names {
                if let Some(sec) = cfg.get("git").and_then(|g| g.get(&n)) {
                    if account.is_none() {
                        account = sec
                            .get("account")
                            .and_then(|v| v.as_str())
                            .map(String::from);
                    }
                    if key.is_none() {
                        key = sec.get("key").and_then(|v| v.as_str()).map(String::from);
                    }
                    break;
                }
            }
        }
    }
    let account = match account {
        Some(a) => AccountNumber::from_str(&a).map_err(|e| anyhow!("bad account {a}: {e}"))?,
        None => remote.owner,
    };
    Ok(Signer { account, key })
}

// ---------------------------------------------------------------- local git

fn git(args: &[&str]) -> Result<String> {
    let out = Command::new("git")
        .args(args)
        .stderr(Stdio::inherit())
        .output()?;
    if !out.status.success() {
        bail!("git {} failed", args.join(" "));
    }
    Ok(String::from_utf8(out.stdout)?)
}

fn have_local(oid: &str) -> bool {
    Command::new("git")
        .args(["cat-file", "-e", oid])
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn git_dir() -> Result<PathBuf> {
    match std::env::var_os("GIT_DIR") {
        Some(d) => Ok(PathBuf::from(d)),
        None => Ok(PathBuf::from(git(&["rev-parse", "--git-dir"])?.trim())),
    }
}

fn inflate(data: &[u8]) -> Result<(String, Vec<u8>)> {
    let mut raw = Vec::new();
    flate2::read::ZlibDecoder::new(data)
        .take((MAX_OBJECT_SIZE + 64) as u64)
        .read_to_end(&mut raw)?;
    let nul = raw
        .iter()
        .position(|&b| b == 0)
        .ok_or(anyhow!("bad object"))?;
    let header = std::str::from_utf8(&raw[..nul])?;
    let ty = header.split(' ').next().unwrap_or("").to_string();
    Ok((ty, raw[nul + 1..].to_vec()))
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn links(ty: &str, content: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    match ty {
        "commit" | "tag" => {
            for line in content.split(|&b| b == b'\n').take_while(|l| !l.is_empty()) {
                let l = String::from_utf8_lossy(line);
                for k in ["tree ", "parent ", "object "] {
                    if let Some(v) = l.strip_prefix(k) {
                        out.push(v.to_string());
                    }
                }
            }
        }
        "tree" => {
            let mut i = 0;
            while i < content.len() {
                let Some(sp) = content[i..].iter().position(|&b| b == b' ') else {
                    break;
                };
                let mode = &content[i..i + sp];
                let Some(nul) = content[i..].iter().position(|&b| b == 0) else {
                    break;
                };
                let s = i + nul + 1;
                if s + 20 > content.len() {
                    break;
                }
                if mode != b"160000" {
                    out.push(hex(&content[s..s + 20]));
                }
                i = s + 20;
            }
        }
        _ => {}
    }
    out
}

/// Download every object reachable from `tips` that the local repo lacks,
/// writing them as loose objects.
async fn fetch(remote: &Remote, tips: &[String]) -> Result<()> {
    let objdir = git_dir()?.join("objects");
    let mut seen = HashSet::new();
    let mut q: VecDeque<String> = tips.iter().cloned().collect();
    while let Some(oid) = q.pop_front() {
        if !seen.insert(oid.clone()) || have_local(&oid) {
            continue;
        }
        let path = format!("objects/{}/{}", &oid[..2], &oid[2..]);
        let data = remote
            .get(&path)
            .await?
            .ok_or_else(|| anyhow!("remote is missing object {oid}"))?;
        let (ty, content) = inflate(&data)?;
        let dir = objdir.join(&oid[..2]);
        std::fs::create_dir_all(&dir)?;
        let tmp = dir.join(format!("tmp_{}", &oid[2..]));
        std::fs::write(&tmp, &data)?;
        std::fs::rename(&tmp, dir.join(&oid[2..]))?;
        q.extend(links(&ty, &content));
    }
    Ok(())
}

// ---------------------------------------------------------------- push

fn deflate(ty: &str, content: &[u8]) -> Result<Vec<u8>> {
    let mut e = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    write!(e, "{} {}\0", ty, content.len())?;
    e.write_all(content)?;
    Ok(e.finish()?)
}

/// New objects as (oid, path-hint, zlib bytes).
fn new_objects(new: &[String], remote_tips: &[String]) -> Result<Vec<(String, String, Vec<u8>)>> {
    let mut args = vec!["rev-list", "--objects"];
    args.extend(new.iter().map(String::as_str));
    let have: Vec<&String> = remote_tips.iter().filter(|o| have_local(o)).collect();
    if !have.is_empty() {
        args.push("--not");
        args.extend(have.iter().map(|s| s.as_str()));
    }
    let list = git(&args)?;
    let entries: Vec<(String, String)> = list
        .lines()
        .map(|l| {
            let (o, p) = l.split_once(' ').unwrap_or((l, ""));
            (o.to_string(), p.to_string())
        })
        .collect();
    let mut child = Command::new("git")
        .args(["cat-file", "--batch"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()?;
    let mut stdin = child.stdin.take().unwrap();
    let input: String = entries.iter().map(|(o, _)| format!("{o}\n")).collect();
    let writer = std::thread::spawn(move || stdin.write_all(input.as_bytes()));
    let mut out = std::io::BufReader::new(child.stdout.take().unwrap());
    let mut result = Vec::new();
    for (oid, path) in entries {
        let mut header = String::new();
        out.read_line(&mut header)?;
        let parts: Vec<&str> = header.trim().split(' ').collect();
        if parts.len() != 3 {
            bail!("cat-file: {}", header.trim());
        }
        let size: usize = parts[2].parse()?;
        let mut content = vec![0; size + 1];
        out.read_exact(&mut content)?;
        content.pop();
        if size > MAX_OBJECT_SIZE {
            bail!(
                "{} {} ({} bytes) exceeds the 1 MiB per-object limit; track it with `git lfs track {}`",
                parts[1],
                if path.is_empty() { &oid } else { &path },
                size,
                if path.is_empty() { "<file>" } else { &path }
            );
        }
        result.push((oid, path, deflate(parts[1], &content)?));
    }
    writer.join().unwrap()?;
    child.wait()?;
    Ok(result)
}

async fn submit(
    remote: &Remote,
    keys: &[AnyPrivateKey],
    actions: Vec<Action>,
    wait_for: &str,
) -> Result<()> {
    // Ask a service subdomain directly; the bare root redirects to homepage.
    let transact_url = psibase::account!("transact").url(&remote.root)?;
    let tapos = get_tapos_for_head(&transact_url, remote.client.clone()).await?;
    let now: TimePointSec = chrono::Utc::now().into();
    let trx = Transaction {
        tapos: Tapos {
            expiration: now + Seconds::new(10),
            refBlockSuffix: tapos.ref_block_suffix,
            flags: 0,
            refBlockIndex: tapos.ref_block_index,
        },
        actions,
        claims: vec![],
    };
    let signed = sign_transaction(trx, keys)?;
    let url = psibase::account!("transact")
        .url(&remote.root)?
        .join(&format!("/push_transaction?wait_for={wait_for}"))?;
    let resp = remote
        .client
        .post(url)
        .header("Content-Type", "application/octet-stream")
        .header("Accept", "application/octet-stream")
        .body(signed.packed())
        .send()
        .await?;
    let status = resp.status();
    let body = resp.bytes().await?;
    if !status.is_success() {
        bail!(
            "push_transaction: HTTP {status}: {}",
            String::from_utf8_lossy(&body)
        );
    }
    let trace = TransactionTrace::unpacked(&body)?;
    if let Some(e) = trace.error.filter(|e| !e.is_empty()) {
        bail!("{e}");
    }
    Ok(())
}

fn action(s: &Signer, method: &str, raw: Vec<u8>) -> Action {
    Action {
        sender: s.account,
        service: psibase::account!("git"),
        method: MethodNumber::from(method),
        rawData: raw.into(),
    }
}

/// Returns per-dst result: Ok(()) or Err(message).
async fn push(remote: &Remote, specs: &[String]) -> Result<Vec<(String, Result<(), String>)>> {
    let s = signer(remote)?;
    let key = s.key.clone().ok_or_else(|| {
        anyhow!("no signing key: set PSIBASE_GIT_KEY, git config psibase.key, or [git.<host>] key in ~/.psibase.toml")
    })?;
    let keys = vec![AnyPrivateKey::from_str(&key)?];
    let (remote_refs, _) = remote.list().await?;
    let mut updates = Vec::new();
    let mut new_tips = Vec::new();
    let mut dsts = Vec::new();
    for spec in specs {
        let spec = spec.trim_start_matches('+');
        let (src, dst) = spec
            .split_once(':')
            .ok_or_else(|| anyhow!("bad refspec {spec}"))?;
        let old = remote_refs.get(dst).cloned().unwrap_or(ZERO_OID.into());
        let new = if src.is_empty() {
            ZERO_OID.to_string()
        } else {
            git(&["rev-parse", src])?.trim().to_string()
        };
        if new != ZERO_OID {
            new_tips.push(new.clone());
        }
        dsts.push(dst.to_string());
        updates.push(RefUpdate {
            refname: dst.into(),
            old_oid: old,
            new_oid: new,
        });
    }
    let outcome: Result<()> = async {
        let tips: Vec<String> = remote_refs.values().cloned().collect();
        let objs = if new_tips.is_empty() {
            vec![]
        } else {
            new_objects(&new_tips, &tips)?
        };
        // Group into transactions: dependencies are only checked at updateRefs.
        let mut batch: Vec<GitObject> = Vec::new();
        let mut size = 0;
        let flush = |batch: Vec<GitObject>| PutObjects {
            owner: remote.owner,
            name: remote.repo.clone(),
            objects: batch,
        };
        for (oid, _, data) in objs {
            if size + data.len() > MAX_TX_BYTES && !batch.is_empty() {
                let b = std::mem::take(&mut batch);
                submit(
                    remote,
                    &keys,
                    vec![action(&s, "putObjects", flush(b).packed())],
                    "applied",
                )
                .await?;
                size = 0;
            }
            size += data.len() + 64;
            batch.push(GitObject { oid, data });
        }
        let mut actions = Vec::new();
        if !batch.is_empty() {
            actions.push(action(&s, "putObjects", flush(batch).packed()));
        }
        let upd = UpdateRefs {
            owner: remote.owner,
            name: remote.repo.clone(),
            updates,
        };
        actions.push(action(&s, "updateRefs", upd.packed()));
        // `final` so the next `list` (an HTTP query against committed
        // state) already sees the new refs.
        submit(remote, &keys, actions, "final").await
    }
    .await;
    let r = outcome.map_err(|e| format!("{e:#}").replace('\n', " "));
    Ok(dsts.into_iter().map(|d| (d, r.clone())).collect())
}

// ---------------------------------------------------------------- protocol

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let url = args
        .get(2)
        .or(args.get(1))
        .ok_or(anyhow!("usage: git-remote-psibase <remote> <url>"))?;
    let (root, owner, repo) = parse_url(url)?;
    let remote = Remote {
        root,
        owner,
        repo,
        client: reqwest::Client::new(),
    };

    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    let mut lines = stdin.lock().lines();
    while let Some(line) = lines.next() {
        let line = line?;
        let line = line.trim_end();
        if line == "capabilities" {
            write!(out, "fetch\npush\noption\n\n")?;
        } else if line.starts_with("option ") {
            writeln!(out, "unsupported")?;
        } else if line == "list" || line == "list for-push" {
            let (refs, head) = match remote.list().await {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("git-remote-psibase: {e:#}");
                    std::process::exit(128);
                }
            };
            for (name, oid) in &refs {
                writeln!(out, "{oid} {name}")?;
            }
            if let Some(h) = head.filter(|h| refs.contains_key(h)) {
                writeln!(out, "@{h} HEAD")?;
            }
            writeln!(out)?;
        } else if line.starts_with("fetch ") {
            let mut tips = vec![line.split(' ').nth(1).unwrap_or("").to_string()];
            for l in lines.by_ref() {
                let l = l?;
                if l.is_empty() {
                    break;
                }
                tips.push(l.split(' ').nth(1).unwrap_or("").to_string());
            }
            if let Err(e) = fetch(&remote, &tips).await {
                eprintln!("git-remote-psibase: {e:#}");
                std::process::exit(128);
            }
            writeln!(out)?;
        } else if let Some(spec) = line.strip_prefix("push ") {
            let mut specs = vec![spec.to_string()];
            for l in lines.by_ref() {
                let l = l?;
                if l.is_empty() {
                    break;
                }
                specs.push(l.strip_prefix("push ").unwrap_or(&l).to_string());
            }
            match push(&remote, &specs).await {
                Ok(results) => {
                    for (dst, r) in results {
                        match r {
                            Ok(()) => writeln!(out, "ok {dst}")?,
                            Err(e) => writeln!(out, "error {dst} {e}")?,
                        }
                    }
                }
                Err(e) => {
                    eprintln!("git-remote-psibase: {e:#}");
                    std::process::exit(128);
                }
            }
            writeln!(out)?;
        } else if line.is_empty() {
            break;
        } else {
            bail!("unknown command {line}");
        }
        out.flush()?;
    }
    Ok(())
}
