#!/usr/bin/env python3
"""End-to-end tests for the `git` service and `git-remote-psibase`.

Needs: a running psinode with the Git package installed, `psibase` and
`git-remote-psibase` on PATH, stock `git`, and `openssl`.

    PSINODE_URL=http://psibase.localhost:8080/ python3 git_e2e.py
"""
import json, os, random, string, subprocess, sys, tempfile, zlib, hashlib, urllib.request

API = os.environ.get("PSINODE_URL", "http://psibase.localhost:8080/").rstrip("/")
ROOT = API.split("://", 1)[1]
SCHEME = API.split("://", 1)[0]
GIT_HTTP = f"{SCHEME}://git.{ROOT}"
WORK = tempfile.mkdtemp(prefix="git-e2e-")
SUFFIX = "".join(random.choice(string.ascii_lowercase) for _ in range(5))
ZERO = "0" * 40
results = []


def run(*cmd, cwd=None, env=None, check=True, input=None):
    e = dict(os.environ)
    e.update(env or {})
    p = subprocess.run(cmd, cwd=cwd, env=e, input=input, capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)} failed ({p.returncode}):\n{p.stdout}\n{p.stderr}")
    return p


def test(name):
    def deco(fn):
        try:
            fn()
            results.append((name, True, ""))
            print(f"PASS {name}")
        except Exception as ex:  # noqa
            results.append((name, False, str(ex)))
            print(f"FAIL {name}\n  {ex}")
        return fn
    return deco


def keypair(name):
    priv = os.path.join(WORK, f"{name}.pem")
    pub = os.path.join(WORK, f"{name}.pub.pem")
    run("openssl", "genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", priv)
    run("openssl", "pkey", "-in", priv, "-pubout", "-out", pub)
    return priv, pub


def push_actions(key, actions, check=True):
    f = os.path.join(WORK, "actions.json")
    with open(f, "w") as fh:
        json.dump(actions, fh)
    return run("psibase", "push", "-a", API, "-s", key, f, check=check)


def act(sender, method, data):
    return {"sender": sender, "service": "git", "method": method, "data": data}


def loose(ty, content: bytes):
    raw = f"{ty} {len(content)}\0".encode() + content
    return hashlib.sha1(raw).hexdigest(), zlib.compress(raw).hex()


def git_env(account, key, home=None):
    e = {"PSIBASE_GIT_ACCOUNT": account, "PSIBASE_GIT_KEY": key,
         "GIT_AUTHOR_NAME": account, "GIT_AUTHOR_EMAIL": f"{account}@x",
         "GIT_COMMITTER_NAME": account, "GIT_COMMITTER_EMAIL": f"{account}@x"}
    if home:
        e["HOME"] = home
    return e


def commit(repo, env, fname, text, msg):
    with open(os.path.join(repo, fname), "w") as fh:
        fh.write(text)
    run("git", "add", fname, cwd=repo)
    run("git", "commit", "-qm", msg, cwd=repo, env=env)
    return run("git", "rev-parse", "HEAD", cwd=repo).stdout.strip()


def remote_ref(repo_name, ref):
    body = urllib.request.urlopen(f"{GIT_HTTP}/alice{SUFFIX}/{repo_name}.git/info/refs").read().decode()
    for line in body.splitlines():
        oid, name = line.split("\t")
        if name == ref:
            return oid
    return None


alice, bob, carol = f"alice{SUFFIX}", f"bob{SUFFIX}", f"carol{SUFFIX}"
keys = {}
for who in (alice, bob, carol):
    keys[who] = keypair(who)
    run("psibase", "create", "-a", API, "-k", keys[who][1], who)
AK, BK = keys[alice][0], keys[bob][0]
REPO = "notes"
HELPER_URL = f"psibase::{API}/{alice}/{REPO}"
A = os.path.join(WORK, "a")


@test("create repo with psibase push; HEAD and empty info/refs served")
def _():
    push_actions(AK, [act(alice, "create", {"name": REPO})])
    head = urllib.request.urlopen(f"{GIT_HTTP}/{alice}/{REPO}.git/HEAD").read().decode()
    assert head == "ref: refs/heads/main\n", head
    refs = urllib.request.urlopen(f"{GIT_HTTP}/{alice}/{REPO}.git/info/refs").read()
    assert refs == b"", refs


@test("helper push of first commit (key from env)")
def _():
    run("git", "init", "-q", "-b", "main", A)
    env = git_env(alice, AK)
    commit(A, env, "README", "hello\n", "first")
    os.makedirs(os.path.join(A, "src"))
    commit(A, env, "src/a.txt", "a\n" * 1000, "second")
    run("git", "remote", "add", "origin", HELPER_URL, cwd=A)
    run("git", "push", "-q", "origin", "main", cwd=A, env=env)
    assert remote_ref(REPO, "refs/heads/main") == run("git", "rev-parse", "HEAD", cwd=A).stdout.strip()


@test("stock git clone over dumb HTTP sees the push")
def _():
    d = os.path.join(WORK, "stock")
    run("git", "clone", "-q", f"{GIT_HTTP}/{alice}/{REPO}.git", d)
    assert run("git", "rev-parse", "HEAD", cwd=d).stdout == run("git", "rev-parse", "HEAD", cwd=A).stdout
    run("git", "fsck", "--full", cwd=d)
    assert open(os.path.join(d, "src/a.txt")).read() == "a\n" * 1000


@test("helper clone, then helper fetch sees a later push")
def _():
    d = os.path.join(WORK, "hclone")
    run("git", "clone", "-q", HELPER_URL, d)
    env = git_env(alice, AK)
    new = commit(A, env, "README", "hello again\n", "third")
    run("git", "push", "-q", "origin", "main", cwd=A, env=env)
    run("git", "fetch", "-q", "origin", cwd=d)
    assert run("git", "rev-parse", "origin/main", cwd=d).stdout.strip() == new
    run("git", "fsck", "--full", cwd=d)


@test("account and key from ~/.psibase.toml [git.<host>]")
def _():
    home = os.path.join(WORK, "home")
    os.makedirs(home)
    with open(os.path.join(home, ".psibase.toml"), "w") as fh:
        fh.write(f'[hosts]\nlocal = "{API}/"\n\n[git.local]\naccount = "{alice}"\nkey = "{AK}"\n')
    env = git_env(alice, AK, home)
    del env["PSIBASE_GIT_ACCOUNT"], env["PSIBASE_GIT_KEY"]
    env["PSIBASE_GIT_ACCOUNT"] = ""
    env["PSIBASE_GIT_KEY"] = ""
    new = commit(A, git_env(alice, AK), "c.txt", "c\n", "via toml")
    run("git", "push", "-q", "origin", "main", cwd=A, env=env)
    assert remote_ref(REPO, "refs/heads/main") == new


@test("annotated tag pushes and is peeled in info/refs")
def _():
    env = git_env(alice, AK)
    run("git", "tag", "-a", "v1", "-m", "v1", cwd=A, env=env)
    run("git", "push", "-q", "origin", "v1", cwd=A, env=env)
    body = urllib.request.urlopen(f"{GIT_HTTP}/{alice}/{REPO}.git/info/refs").read().decode()
    assert "refs/tags/v1^{}" in body, body


B = os.path.join(WORK, "b")


@test("non-writer push is rejected")
def _():
    env = git_env(bob, BK)
    run("git", "clone", "-q", HELPER_URL, B)
    commit(B, env, "bob.txt", "bob\n", "bob1")
    p = run("git", "push", "origin", "main", cwd=B, env=env, check=False)
    assert p.returncode != 0, p.stdout + p.stderr


@test("fast-forward from a second writer (update flag) lands")
def _():
    push_actions(AK, [act(alice, "setWriter", {"name": REPO, "account": bob, "flags": 1})])
    env = git_env(bob, BK)
    run("git", "push", "-q", "origin", "main", cwd=B, env=env)
    assert remote_ref(REPO, "refs/heads/main") == run("git", "rev-parse", "HEAD", cwd=B).stdout.strip()


@test("non-fast-forward without force flag fails; owner can force")
def _():
    env = git_env(bob, BK)
    before = remote_ref(REPO, "refs/heads/main")
    run("git", "reset", "-q", "--hard", "HEAD~1", cwd=B)
    commit(B, env, "bob2.txt", "x\n", "divergent")
    p = run("git", "push", "--force", "origin", "main", cwd=B, env=env, check=False)
    assert p.returncode != 0 and "force" in (p.stdout + p.stderr), p.stdout + p.stderr
    assert remote_ref(REPO, "refs/heads/main") == before
    # owner has every flag
    aenv = git_env(alice, AK)
    run("git", "fetch", "-q", B, "main:divergent", cwd=A)
    run("git", "push", "-q", "--force", "origin", "divergent:main", cwd=A, env=aenv)
    assert remote_ref(REPO, "refs/heads/main") == run("git", "rev-parse", "divergent", cwd=A).stdout.strip()


@test("delete needs delete flag")
def _():
    env = git_env(bob, BK)
    run("git", "push", "-q", "origin", "main:refs/heads/tmp", cwd=B, env=env, check=False)
    run("git", "push", "-q", "origin", f"{run('git','rev-parse','origin/main',cwd=B).stdout.strip()}:refs/heads/tmp2", cwd=B, env=env)
    p = run("git", "push", "origin", ":refs/heads/tmp2", cwd=B, env=env, check=False)
    assert p.returncode != 0 and remote_ref(REPO, "refs/heads/tmp2")
    run("git", "push", "-q", "origin", ":refs/heads/tmp2", cwd=A, env=git_env(alice, AK))
    assert remote_ref(REPO, "refs/heads/tmp2") is None


@test("two updates with the same old_oid: one succeeds, one is rejected")
def _():
    tip = remote_ref(REPO, "refs/heads/main")
    first = run("git", "rev-parse", "HEAD~1", cwd=A).stdout.strip()
    u = lambda new: act(alice, "updateRefs", {"owner": alice, "name": REPO,
                                              "updates": [{"refname": "refs/heads/race", "old_oid": ZERO, "new_oid": new}]})
    push_actions(AK, [u(tip)])
    p = push_actions(AK, [u(first)], check=False)
    assert p.returncode != 0 and "stale old_oid" in (p.stdout + p.stderr), p.stdout + p.stderr
    assert remote_ref(REPO, "refs/heads/race") == tip


@test("object whose bytes do not match its id is rejected")
def _():
    oid, data = loose("blob", b"real\n")
    bad = "1" * 40
    p = push_actions(AK, [act(alice, "putObjects", {"owner": alice, "name": REPO, "objects": [{"oid": bad, "data": data}]})], check=False)
    assert p.returncode != 0 and "mismatch" in (p.stdout + p.stderr), p.stdout + p.stderr


@test("object over 1 MiB (inflated) is rejected; 800 KiB object plus small ones accepted")
def _():
    oid, data = loose("blob", b"\0" * (1024 * 1024 + 1))
    p = push_actions(AK, [act(alice, "putObjects", {"owner": alice, "name": REPO, "objects": [{"oid": oid, "data": data}]})], check=False)
    assert p.returncode != 0 and "1 MiB" in (p.stdout + p.stderr), p.stdout + p.stderr
    objs = [loose("blob", b"y" * (800 * 1024))] + [loose("blob", f"tiny{i}\n".encode()) for i in range(50)]
    push_actions(AK, [act(alice, "putObjects", {"owner": alice, "name": REPO,
                                              "objects": [{"oid": o, "data": d} for o, d in objs]})])
    st = urllib.request.urlopen(f"{GIT_HTTP}/{alice}/{REPO}.git/objects/{objs[0][0][:2]}/{objs[0][0][2:]}").status
    assert st == 200


@test("helper refuses a >1 MiB file before signing, naming the file")
def _():
    d = os.path.join(WORK, "big")
    run("git", "clone", "-q", HELPER_URL, d)
    env = git_env(alice, AK)
    with open(os.path.join(d, "big.bin"), "wb") as fh:
        fh.write(os.urandom(1024 * 1024 + 10))
    run("git", "add", "big.bin", cwd=d)
    run("git", "commit", "-qm", "big", cwd=d, env=env)
    p = run("git", "push", "origin", "main", cwd=d, env=env, check=False)
    assert p.returncode != 0 and "big.bin" in p.stderr + p.stdout and "lfs" in (p.stderr + p.stdout), p.stderr


@test("import larger than one transaction is split across putObjects transactions")
def _():
    d = os.path.join(WORK, "multi")
    run("git", "clone", "-q", HELPER_URL, d)
    env = git_env(alice, AK)
    for i in range(5):
        with open(os.path.join(d, f"chunk{i}.bin"), "wb") as fh:
            fh.write(os.urandom(900 * 1024))
    run("git", "add", ".", cwd=d)
    run("git", "commit", "-qm", "multi", cwd=d, env=env)
    run("git", "push", "-q", "origin", "HEAD:refs/heads/multi", cwd=d, env=env)
    c = os.path.join(WORK, "multi-clone")
    run("git", "clone", "-q", "-b", "multi", f"{GIT_HTTP}/{alice}/{REPO}.git", c)
    run("git", "fsck", "--full", cwd=c)


@test("ref that points at a commit whose blob is missing is rejected")
def _():
    blob = "2" * 40
    tree_oid, tree = loose("tree", b"100644 f\0" + bytes.fromhex(blob))
    c_oid, c = loose("commit", f"tree {tree_oid}\nauthor a <a> 0 +0000\ncommitter a <a> 0 +0000\n\nm\n".encode())
    push_actions(AK, [act(alice, "putObjects", {"owner": alice, "name": REPO,
                                              "objects": [{"oid": tree_oid, "data": tree}, {"oid": c_oid, "data": c}]})])
    p = push_actions(AK, [act(alice, "updateRefs", {"owner": alice, "name": REPO,
                                                  "updates": [{"refname": "refs/heads/broken", "old_oid": ZERO, "new_oid": c_oid}]})], check=False)
    assert p.returncode != 0 and "missing object" in (p.stdout + p.stderr), p.stdout + p.stderr
    assert remote_ref(REPO, "refs/heads/broken") is None


@test("smart-HTTP POST endpoints and packs return 404")
def _():
    for path in ("objects/info/packs",):
        try:
            urllib.request.urlopen(f"{GIT_HTTP}/{alice}/{REPO}.git/{path}")
            raise AssertionError(path)
        except urllib.error.HTTPError as e:
            assert e.code == 404
    req = urllib.request.Request(f"{GIT_HTTP}/{alice}/{REPO}.git/git-upload-pack", data=b"x", method="POST")
    try:
        urllib.request.urlopen(req)
        raise AssertionError("POST")
    except urllib.error.HTTPError as e:
        assert e.code == 404, e.code


failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} passed (work dir {WORK})")
sys.exit(1 if failed else 0)
