//! Generic signature-only daemon. Depends only on cryptography, HTTP and Psibase submission.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Config {
    node_url: String,
    host: String,
    chain_url: String,
    cli: String,
    provider: String,
    key_path: PathBuf,
    auth_key_path: PathBuf,
    deployment: String,
    journal: PathBuf,
}
#[derive(Serialize, Deserialize)]
struct Secret {
    deployment: String,
    seed: String,
}
#[derive(Default, Serialize, Deserialize)]
struct Journal {
    requests: BTreeMap<u64, Value>,
}
fn secure_read(path: &Path) -> Result<String> {
    let m = fs::symlink_metadata(path)?;
    if !m.is_file() || m.permissions().mode() & 0o077 != 0 {
        return Err("Custody key/journal must be a private regular file (0600)".into());
    }
    Ok(fs::read_to_string(path)?)
}
fn private_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    f.write_all(bytes)?;
    f.sync_all()?;
    Ok(())
}
fn store(path: &Path, journal: &Journal) -> Result<()> {
    let tmp = path.with_extension("new");
    private_write(&tmp, &serde_json::to_vec(journal)?)?;
    fs::rename(&tmp, path)?;
    if let Some(parent) = path.parent() {
        fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}
fn generate(dir: &Path) -> Result<()> {
    use rand::RngCore;
    fs::create_dir_all(dir)?;
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    let mut deployment = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut deployment);
    let deployment = encode(&deployment);
    for n in 0..3 {
        let mut seed = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut seed);
        private_write(
            &dir.join(format!("signer-{n}.key")),
            &serde_json::to_vec(&Secret {
                deployment: deployment.clone(),
                seed: encode(&seed),
            })?,
        )?;
    }
    println!("{}", json!({"deployment":deployment}));
    Ok(())
}
fn encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn submit(c: &Config, method: &str, data: Value) -> Result<()> {
    secure_read(&c.auth_key_path)?;
    let actions = json!([{"sender":c.provider,"service":"signhash","method":method,"data":data}]);
    let mut child = Command::new(&c.cli)
        .args([
            "push",
            "-a",
            &c.chain_url,
            "--sign",
            c.auth_key_path
                .to_str()
                .ok_or("Invalid authentication key path")?,
            "--console=false",
            "--trace",
            "error",
            "-",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()?;
    child
        .stdin
        .take()
        .unwrap()
        .write_all(serde_json::to_string(&actions)?.as_bytes())?;
    let o = child.wait_with_output()?;
    if !o.status.success() {
        return Err(format!(
            "Psibase submission failed: {}",
            String::from_utf8_lossy(&o.stderr)
        )
        .into());
    }
    Ok(())
}
fn number(v: &Value, k: &str) -> Result<u64> {
    v[k].as_u64()
        .ok_or_else(|| format!("Missing integer {k}").into())
}
fn once(c: &Config, secret: &Secret, journal: &mut Journal) -> Result<()> {
    let r = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(15))
        .redirects(0)
        .build()
        .get(&format!(
            "{}/snapshot?provider={}",
            c.node_url.trim_end_matches('/'),
            c.provider
        ))
        .set("Host", &c.host)
        .call()?;
    let mut body = String::new();
    r.into_reader().take(4_000_001).read_to_string(&mut body)?;
    if body.len() > 4_000_000 {
        return Err("Signing snapshot exceeds limit".into());
    }
    let s: Value = serde_json::from_str(&body)?;
    if s["config"]["deployment"] != c.deployment {
        return Err("Signing deployment identity mismatch".into());
    }
    let local = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs();
    if number(&s, "now")?.abs_diff(local) > 120
        || number(&s, "commit_num")? > number(&s, "block_num")?
    {
        return Err("Stale or invalid Psibase finality state".into());
    }
    let keys = s["keys"].as_array().ok_or("Missing signing keys")?;
    for k in keys {
        if k["provider"] != c.provider {
            return Err("Signing provider mismatch".into());
        }
        if number(k, "requested_block")? > number(&s, "commit_num")? {
            continue;
        }
        let id = u32::try_from(number(k, "id")?)?;
        let public = signing_core::public_key(&secret.seed, id)?;
        if k["public_root"] == "" {
            submit(c, "publishKey", json!({"key":id,"public_root":public}))?;
            println!("Published public key {id}");
        } else if k["public_root"] != public {
            return Err("Published public key differs from local custody key".into());
        }
    }
    for request in s["requests"].as_array().ok_or("Missing signing requests")? {
        if number(request, "requested_block")? > number(&s, "commit_num")? {
            continue;
        }
        let id = number(request, "id")?;
        let key = u32::try_from(number(request, "key")?)?;
        let k = keys
            .iter()
            .find(|k| k["id"] == key)
            .ok_or("Unknown requested key")?;
        if request["provider"] != c.provider || k["public_root"] == "" {
            return Err("Signing request provider/key mismatch".into());
        }
        let path: Vec<u32> = serde_json::from_value(request["path"].clone())?;
        let hash = request["hash"].as_str().ok_or("Missing digest")?;
        let root = signing_core::public_key(&secret.seed, key)?;
        if signing_core::child_public(&root, &path)? != request["public_key"] {
            return Err("Requested public key differs from derived key".into());
        }
        if let Some(old) = journal.requests.get(&id) {
            if old != request {
                return Err("Finalized signing request changed".into());
            }
        }
        journal.requests.insert(id, request.clone());
        store(&c.journal, journal)?;
        let signature = signing_core::sign(&secret.seed, key, &path, hash)?;
        submit(c, "publishSig", json!({"request":id,"signature":signature}))?;
        println!("Published signature for request {id}, key {key}");
    }
    Ok(())
}
fn run() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 3 {
        return Err("Usage: signing-daemon generate DIR | once CONFIG | watch CONFIG".into());
    }
    if args[1] == "generate" {
        return generate(Path::new(&args[2]));
    }
    if args[1] != "once" && args[1] != "watch" {
        return Err("Unknown signing command".into());
    }
    let c: Config = serde_json::from_str(&fs::read_to_string(&args[2])?)?;
    if !c
        .provider
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("Invalid provider name".into());
    }
    let loopback =
        c.node_url.starts_with("http://127.0.0.1:") || c.node_url.starts_with("http://localhost:");
    if !loopback && !c.node_url.starts_with("https://") {
        return Err("Remote Psibase nodes require HTTPS".into());
    }
    let secret: Secret = serde_json::from_str(&secure_read(&c.key_path)?)?;
    if secret.deployment != c.deployment {
        return Err("Secret belongs to another signing deployment".into());
    }
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .open(c.journal.with_extension("lock"))?;
    fs2::FileExt::try_lock_exclusive(&lock)?;
    let mut journal: Journal = if c.journal.exists() {
        serde_json::from_str(&secure_read(&c.journal)?)?
    } else {
        Journal::default()
    };
    loop {
        if args[1] == "once" {
            once(&c, &secret, &mut journal)?;
            return Ok(());
        }
        if let Err(e) = once(&c, &secret, &mut journal) {
            eprintln!("Signing cycle withheld: {e}");
        }
        std::thread::sleep(Duration::from_secs(3));
    }
}
fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
