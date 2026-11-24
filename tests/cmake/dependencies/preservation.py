"""Disposable Git fixtures for non-destructive dependency acquisition."""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

module = Path(__file__).resolve().parents[3] / "cmake/PsibaseDependencies.cmake"
out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
env = dict(os.environ, GIT_OPTIONAL_LOCKS="0", GIT_TERMINAL_PROMPT="0")
steps = []

def run(argv, cwd=None, ok=(0,)):
    result = subprocess.run(argv, cwd=cwd, text=True, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    assert result.returncode in ok, (argv, result.stdout)
    return result.stdout.strip()

def git(repo, *args, ok=(0,)):
    return run(["git", "-C", str(repo), *args], ok=ok)

def snapshot(repo):
    # Include Git metadata bytes: HEAD, refs, raw index and reflogs as well as
    # tracked/untracked/ignored working files. Read-only checks must not alter it.
    return {str(p.relative_to(repo)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(repo.rglob("*")) if p.is_file()}

def project(root, source, revision, repository):
    repository = Path(repository)
    root.mkdir(parents=True, exist_ok=True)
    (root / "CMakeLists.txt").write_text(f'''cmake_minimum_required(VERSION 3.20)
project(preservation NONE)
include("{module.as_posix()}")
FetchContent_Declare(ucc GIT_REPOSITORY "{repository.as_posix()}"
 GIT_TAG {revision} SOURCE_DIR "{source.as_posix()}"
 SOURCE_SUBDIR .psibase-no-top-level-cmake)
psibase_acquire_dependency(ucc)
''')

def worktree(repo):
    # Working files only (tracked, untracked and ignored), without .git.
    return {k: v for k, v in snapshot(repo).items() if not k.startswith(".git/")}

def configure(name, project_dir, build, repo=None, expected=0, override=None,
              advanced=None, says=(), args=(), extra_env=None, metadata_may_change=False):
    """advanced=(repo, old, new): the clean checkout must be moved from old to
    new. Otherwise a given repo must be byte-identical afterwards, .git
    included; metadata_may_change (a refusal after a successful fetch) limits
    that to HEAD, refs and working files."""
    watched = None if advanced else repo
    before = snapshot(watched) if watched else None
    before_refs = git(watched, "for-each-ref") if watched and metadata_may_change else None
    argv = ["cmake", "-S", str(project_dir), "-B", str(build), "-G", "Ninja"]
    argv.extend(sys.argv[2:])
    argv.extend(args)
    if override:
        argv.append("-DFETCHCONTENT_SOURCE_DIR_UCC=" + str(override))
    result = subprocess.run(argv, env=dict(env, **(extra_env or {})),
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    (out / (name + ".log")).write_text(result.stdout)
    if watched and metadata_may_change:
        assert worktree(watched) == {k: v for k, v in before.items() if not k.startswith(".git/")}, name
        assert snapshot(watched).get(".git/HEAD") == before[".git/HEAD"], name
        assert git(watched, "for-each-ref") == before_refs, name
    elif watched:
        assert before == snapshot(watched), f"{name} changed source/Git metadata"
    assert (result.returncode == 0) == (expected == 0), result.stdout
    if expected:
        assert "Preserving existing ucc source" in result.stdout
    # CMake wraps message text; compare with whitespace collapsed.
    flat = " ".join(result.stdout.split())
    for text in says:
        assert " ".join(text.split()) in flat, f"{name}: missing {text!r} in\n{result.stdout}"
    provenance = build / "psibase-dependencies/ucc-source.txt"
    if advanced:
        moved, old, new = advanced
        assert f"psibase: advanced ucc from {old} to {new}" in result.stdout, result.stdout
        assert git(moved, "rev-parse", "HEAD") == new
        assert git(moved, "status", "--porcelain", "--untracked-files=all", "--ignored") == ""
        assert git(moved, "cat-file", "-t", old) == "commit"
        assert git(moved, "symbolic-ref", "-q", "HEAD", ok=(1,)) == ""
    else:
        assert "psibase: advanced" not in result.stdout, result.stdout
    if expected == 0:
        mode = ("explicit-override" if override else "advanced-existing" if advanced
                else "verified-existing" if repo else "fetched")
        assert f"mode={mode}\n" in provenance.read_text()
        if not override:
            assert "FETCHCONTENT_SOURCE_DIR_UCC:PATH=\n" in (build / "CMakeCache.txt").read_text()
    steps.append({"name": name, "argv": argv, "exit_code": result.returncode,
                  "expected": expected,
                  "source_and_git_metadata_unchanged": bool(watched) and not metadata_may_change,
                  "advanced": list(advanced[1:]) if advanced else None,
                  "provenance": provenance.read_text() if provenance.exists() else None})
    (out / "results.json").write_text(json.dumps({"steps": steps}, indent=2) + "\n")

with tempfile.TemporaryDirectory(prefix="psibase-dependency-preservation-") as scratch:
    root = Path(scratch)
    repo = root / "existing"
    run(["git", "init", "-b", "fixture", str(repo)])
    git(repo, "config", "user.name", "Preservation fixture")
    git(repo, "config", "user.email", "fixture@example.invalid")
    (repo / "CMakeLists.txt").write_text('message(FATAL_ERROR "fixture upstream root must not run")\n')
    (repo / "tracked.txt").write_text("base\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "fixture base")
    base = git(repo, "rev-parse", "HEAD")
    (repo / "local-only.txt").write_text("unpushed authored work\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "unpublished local commit")
    unpublished = git(repo, "rev-parse", "HEAD")
    git(repo, "tag", "-a", "local/keep", "-m", "unpublished local tag")
    git(repo, "switch", "--detach", base)
    proj = root / "project"
    project(proj, repo, base, repo)
    configure("clean-local-refs", proj, root / "build-a", repo)
    configure("normal-reconfigure", proj, root / "build-a", repo)
    configure("second-build-tree", proj, root / "build-b", repo)
    project(proj, repo, unpublished, repo)
    # Was "changed-winning-pin-rejected": a clean checkout on a detached HEAD
    # whose commit a local branch contains is now advanced to the new pin.
    # The local branch, the annotated tag and the old commit are kept.
    configure("changed-winning-pin-advanced", proj, root / "build-a", advanced=(repo, base, unpublished))
    assert git(repo, "rev-parse", "fixture") == unpublished
    assert git(repo, "rev-parse", "local/keep^{}") == unpublished
    git(repo, "switch", "--detach", base)
    project(proj, repo, base, repo)

    (repo / "tracked.txt").write_text("dirty authored work\n")
    (repo / "new.txt").write_text("untracked authored work\n")
    configure("dirty-source-rejected", proj, root / "build-dirty", repo, expected=1,
              says=["uncommitted changes or untracked files", "M tracked.txt", "?? new.txt"])
    (repo / "tracked.txt").write_text("base\n")
    (repo / "new.txt").unlink()
    git(repo, "switch", "fixture")
    assert git(repo, "rev-parse", "HEAD") == unpublished
    configure("clean-unpushed-head-rejected", proj, root / "build-local-head", repo, expected=1,
              says=["the checkout is on the local branch 'fixture'"])
    (repo / "tracked.txt").write_text("dirty on unpublished HEAD\n")
    configure("explicit-dev-override", proj, root / "build-override", repo, override=repo)

    (repo / "tracked.txt").write_text("base\n")
    git(repo, "switch", "--detach", base)
    git(repo, "update-index", "--assume-unchanged", "tracked.txt")
    (repo / "tracked.txt").write_text("hidden authored edit\n")
    configure("hidden-index-edit-rejected", proj, root / "build-hidden", repo, expected=1,
              says=["index flags (assume-unchanged or skip-worktree) can hide edits", "h tracked.txt",
                    "update-index --no-assume-unchanged -- <file>"])
    (repo / "tracked.txt").write_text("base\n")
    git(repo, "update-index", "--no-assume-unchanged", "tracked.txt")

    ordinary = root / "not-git"
    ordinary.mkdir()
    (ordinary / "private-work.txt").write_text("must not delete\n")
    nongit_proj = root / "nongit-project"
    project(nongit_proj, ordinary, base, repo)
    configure("non-git-directory-rejected", nongit_proj, root / "build-nongit", ordinary, expected=1,
              says=["it is not a Git checkout root (it is not a Git checkout)", f'mv "{ordinary.as_posix()}"'])

    fresh = root / "fresh-source"
    fresh_proj = root / "fresh-project"
    project(fresh_proj, fresh, base, repo)
    configure("first-fresh-fetch", fresh_proj, root / "build-fresh")
    assert git(fresh, "rev-parse", "HEAD") == base
    assert git(fresh, "rev-parse", "local/keep^{}") == unpublished
    configure("fresh-source-second-build", fresh_proj, root / "build-fresh-second", fresh)

    # Independent first populations must not race to remove the same source.
    concurrent = root / "concurrent-source"
    concurrent_proj = root / "concurrent-project"
    project(concurrent_proj, concurrent, base, repo)
    jobs = []
    for i in range(2):
        name = f"concurrent-first-population-{i}"
        argv = ["cmake", "-S", str(concurrent_proj), "-B", str(root / f"build-concurrent-{i}"), "-G", "Ninja", *sys.argv[2:]]
        log = (out / (name + ".log")).open("w")
        jobs.append((name, argv, log, subprocess.Popen(argv, env=env, stdout=log, stderr=subprocess.STDOUT)))
    for name, argv, log, job in jobs:
        result = job.wait(timeout=60)
        log.close()
        assert result == 0, (out / (name + ".log")).read_text()
        steps.append({"name": name, "argv": argv, "exit_code": result, "expected": 0})
    assert git(concurrent, "rev-parse", "HEAD") == base
    assert git(concurrent, "rev-parse", "local/keep^{}") == unpublished

    # A moved pin. The remotes are local bare repositories: no network.
    upstream = root / "upstream-work"
    run(["git", "init", "-b", "main", str(upstream)])
    git(upstream, "config", "user.name", "Preservation fixture")
    git(upstream, "config", "user.email", "fixture@example.invalid")
    remote = root / "remote.git"
    run(["git", "init", "--bare", "-b", "main", str(remote)])

    def publish(text, branch="main"):
        git(upstream, "switch", branch, ok=(0, 128))
        if git(upstream, "symbolic-ref", "--short", "HEAD") != branch:
            git(upstream, "switch", "-c", branch)
        (upstream / "tracked.txt").write_text(text + "\n")
        git(upstream, "add", ".")
        git(upstream, "commit", "-m", text)
        git(upstream, "push", str(remote), branch)
        return git(upstream, "rev-parse", "HEAD")

    (upstream / ".gitignore").write_text("*.local\n")
    old = publish("old pin")

    def checkout_at_old(name):
        # What FetchContent leaves behind: a full clone on a detached HEAD.
        dest = root / name
        run(["git", "clone", str(remote), str(dest)])
        git(dest, "config", "user.name", "Preservation fixture")
        git(dest, "config", "user.email", "fixture@example.invalid")
        git(dest, "checkout", "--detach", old)
        return dest

    def manual(dest, repository, revision):
        return [f'git -C "{dest.as_posix()}" fetch "{Path(repository).as_posix()}" {revision}',
                f'git -C "{dest.as_posix()}" checkout --detach {revision}',
                f'-DFETCHCONTENT_SOURCE_DIR_UCC="{dest.as_posix()}"']

    # The checkout FetchContent itself made, re-pinned in the same build tree
    # to a commit published after it was cloned: fetched and advanced.
    pinned = root / "pinned-source"
    pinned_proj = root / "pinned-project"
    project(pinned_proj, pinned, old, remote)
    configure("repin-first-fetch", pinned_proj, root / "build-pinned")
    assert git(pinned, "symbolic-ref", "-q", "HEAD", ok=(1,)) == ""
    stale = {name: checkout_at_old(name) for name in
             ("on-branch", "unreachable", "dirty", "untracked", "hidden", "bogus", "disconnected-absent",
              "ignored")}
    new = publish("new pin")
    assert git(pinned, "cat-file", "-t", new, ok=(0, 128)) != "commit"
    project(pinned_proj, pinned, new, remote)
    configure("repin-clean-detached-advanced", pinned_proj, root / "build-pinned", advanced=(pinned, old, new),
              says=[f"fetched from {remote.as_posix()}"])
    configure("repin-advanced-reconfigure", pinned_proj, root / "build-pinned", pinned)
    configure("repin-advanced-second-build-tree", pinned_proj, root / "build-pinned-second", pinned)

    def repin(name, dest, revision=None, repository=None, **kwargs):
        proj = root / (name + "-project")
        project(proj, dest, revision or new, repository or remote)
        configure(name, proj, root / ("build-" + name), **kwargs)

    # No ref contains the old commit, but it is an ancestor of the new pin.
    ancestor = root / "ancestor"
    run(["git", "init", "-b", "unborn", str(ancestor)])
    git(ancestor, "fetch", str(remote), old)
    git(ancestor, "checkout", "--detach", old)
    assert git(ancestor, "for-each-ref") == ""
    repin("repin-ancestor-without-refs-advanced", ancestor, advanced=(ancestor, old, new))

    # On a local branch at the old pin: not moved (a person put it there).
    dest = stale["on-branch"]
    git(dest, "switch", "-c", "work", old)
    repin("repin-on-local-branch-rejected", dest, repo=dest, expected=1,
          says=["the checkout is on the local branch 'work'", *manual(dest, remote, new)])

    # A commit made on the detached HEAD, contained in no ref and not an
    # ancestor of the new pin: refused, and the commit is still HEAD.
    dest = stale["unreachable"]
    (dest / "tracked.txt").write_text("local detached work\n")
    git(dest, "commit", "-am", "local detached commit")
    local = git(dest, "rev-parse", "HEAD")
    repin("repin-unreachable-local-commit-rejected", dest, repo=dest, expected=1, metadata_may_change=True,
          says=["HEAD is detached at a commit that no branch, tag or remote-tracking ref contains",
                f'git -C "{dest.as_posix()}" branch keep-{local[:12]} {local}', *manual(dest, remote, new)])
    assert git(dest, "rev-parse", "HEAD") == local and git(dest, "cat-file", "-t", local) == "commit"
    # The printed command resolves it: the commit is named, then it advances.
    git(dest, "branch", f"keep-{local[:12]}", local)
    repin("repin-after-naming-local-commit-advanced", dest, advanced=(dest, local, new))
    assert git(dest, "rev-parse", f"keep-{local[:12]}") == local

    dest = stale["dirty"]
    (dest / "tracked.txt").write_text("dirty authored work\n")
    repin("repin-dirty-rejected", dest, repo=dest, expected=1,
          says=["uncommitted changes or untracked files", "M tracked.txt",
                f'git -C "{dest.as_posix()}" stash push --include-untracked',
                f'-DFETCHCONTENT_SOURCE_DIR_UCC="{dest.as_posix()}"'])

    dest = stale["untracked"]
    (dest / "notes.txt").write_text("untracked authored work\n")
    repin("repin-untracked-rejected", dest, repo=dest, expected=1,
          says=["uncommitted changes or untracked files", "?? notes.txt"])

    dest = stale["hidden"]
    git(dest, "update-index", "--skip-worktree", "tracked.txt")
    (dest / "tracked.txt").write_text("hidden authored edit\n")
    repin("repin-hidden-index-edit-rejected", dest, repo=dest, expected=1,
          says=["index flags (assume-unchanged or skip-worktree) can hide edits", "S tracked.txt",
                f'git -C "{dest.as_posix()}" update-index --no-skip-worktree -- <file>'])

    # The repository cannot be reached and the commit is not local.
    dest = stale["bogus"]
    bogus = root / "no-such-remote.git"
    # Byte-identical with Git 2.29 or newer (--no-write-fetch-head); an older
    # Git empties FETCH_HEAD when a fetch fails.
    git_version = tuple(int(x) for x in run(["git", "version"]).split()[2].split(".")[:2])
    repin("repin-fetch-impossible-rejected", dest, repository=bogus, repo=dest, expected=1,
          metadata_may_change=git_version < (2, 29),
          says=[f"the declared commit could not be fetched from {bogus.as_posix()}",
                *manual(dest, bogus, new)])

    # Disconnected: no fetch is attempted, even from a reachable repository.
    dest = stale["disconnected-absent"]
    for option in ("FETCHCONTENT_FULLY_DISCONNECTED", "FETCHCONTENT_UPDATES_DISCONNECTED",
                   "FETCHCONTENT_UPDATES_DISCONNECTED_UCC"):
        repin("repin-absent-commit-" + option.lower().replace("_", "-") + "-rejected", dest, repo=dest,
              expected=1, args=[f"-D{option}=ON"],
              says=["FetchContent is disconnected", *manual(dest, remote, new)])
    # Disconnected with the commit already local: advanced without a remote.
    dest = checkout_at_old("disconnected-present")
    assert git(dest, "cat-file", "-t", new) == "commit"
    repin("repin-present-commit-disconnected-advanced", dest, repository=bogus,
          args=["-DFETCHCONTENT_FULLY_DISCONNECTED=ON"], advanced=(dest, old, new),
          says=["commit already present, no fetch"])

    # An ignored file that the new pin tracks must not be overwritten.
    dest = stale["ignored"]
    (upstream / "settings.local").write_text("published\n")
    git(upstream, "add", "-f", "settings.local")
    tracks_ignored = publish("tracks a formerly ignored path")
    (dest / "settings.local").write_text("private ignored work\n")
    assert git(dest, "status", "--porcelain", "--untracked-files=all") == ""
    repin("repin-would-overwrite-ignored-file-rejected", dest, revision=tracks_ignored, repo=dest, expected=1,
          metadata_may_change=True, says=["git checkout --detach refused to move there", "settings.local"])
    assert (dest / "settings.local").read_text() == "private ignored work\n"

    # A server that refuses a commit that is not a ref tip (protocol v0
    # without allowReachableSHA1InWant): the advertised refs are fetched.
    dest = checkout_at_old("not-a-tip")
    before_refs = git(dest, "for-each-ref")
    not_a_tip = publish("commit below the branch tip", branch="side")
    publish("side branch tip", branch="side")
    v0 = {"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "protocol.version", "GIT_CONFIG_VALUE_0": "0"}
    refused = subprocess.run(["git", "-C", str(dest), "fetch", "--dry-run", str(remote), not_a_tip],
                             env=dict(env, **v0), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    assert refused.returncode != 0 and "unadvertised object" in refused.stdout, refused.stdout
    repin("repin-server-refuses-commit-fetch-advanced", dest, revision=not_a_tip, extra_env=v0,
          advanced=(dest, old, not_a_tip))
    assert git(dest, "for-each-ref") == before_refs

(out / "results.json").write_text(json.dumps({"complete": True, "module_sha256": hashlib.sha256(module.read_bytes()).hexdigest(), "steps": steps}, indent=2) + "\n")
print(f"Passed {len(steps)} disposable preservation cases")
