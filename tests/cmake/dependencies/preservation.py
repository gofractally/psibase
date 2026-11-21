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

def run(argv, cwd=None):
    return subprocess.check_output(argv, cwd=cwd, text=True, env=env, stderr=subprocess.STDOUT).strip()

def git(repo, *args):
    return run(["git", "-C", str(repo), *args])

def snapshot(repo):
    # Include Git metadata bytes: HEAD, refs, raw index and reflogs as well as
    # tracked/untracked/ignored working files. Read-only checks must not alter it.
    return {str(p.relative_to(repo)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(repo.rglob("*")) if p.is_file()}

def project(root, source, revision, repository):
    root.mkdir(parents=True, exist_ok=True)
    (root / "CMakeLists.txt").write_text(f'''cmake_minimum_required(VERSION 3.20)
project(preservation NONE)
include("{module.as_posix()}")
FetchContent_Declare(ucc GIT_REPOSITORY "{repository.as_posix()}"
 GIT_TAG {revision} SOURCE_DIR "{source.as_posix()}"
 SOURCE_SUBDIR .psibase-no-top-level-cmake)
psibase_acquire_dependency(ucc)
''')

def configure(name, project_dir, build, repo=None, expected=0, override=None):
    before = snapshot(repo) if repo else None
    argv = ["cmake", "-S", str(project_dir), "-B", str(build), "-G", "Ninja"]
    argv.extend(sys.argv[2:])
    if override:
        argv.append("-DFETCHCONTENT_SOURCE_DIR_UCC=" + str(override))
    result = subprocess.run(argv, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    (out / (name + ".log")).write_text(result.stdout)
    if repo:
        assert before == snapshot(repo), f"{name} changed source/Git metadata"
    assert (result.returncode == 0) == (expected == 0), result.stdout
    if expected:
        assert "Preserving existing ucc source" in result.stdout
    provenance = build / "psibase-dependencies/ucc-source.txt"
    if expected == 0:
        mode = "explicit-override" if override else ("verified-existing" if repo else "fetched")
        assert f"mode={mode}\n" in provenance.read_text()
        if not override:
            assert "FETCHCONTENT_SOURCE_DIR_UCC:PATH=\n" in (build / "CMakeCache.txt").read_text()
    steps.append({"name": name, "argv": argv, "exit_code": result.returncode,
                  "expected": expected, "source_and_git_metadata_unchanged": repo is not None,
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
    configure("changed-winning-pin-rejected", proj, root / "build-a", repo, expected=1)
    project(proj, repo, base, repo)

    (repo / "tracked.txt").write_text("dirty authored work\n")
    (repo / "new.txt").write_text("untracked authored work\n")
    configure("dirty-source-rejected", proj, root / "build-dirty", repo, expected=1)
    (repo / "tracked.txt").write_text("base\n")
    (repo / "new.txt").unlink()
    git(repo, "switch", "fixture")
    assert git(repo, "rev-parse", "HEAD") == unpublished
    configure("clean-unpushed-head-rejected", proj, root / "build-local-head", repo, expected=1)
    (repo / "tracked.txt").write_text("dirty on unpublished HEAD\n")
    configure("explicit-dev-override", proj, root / "build-override", repo, override=repo)

    (repo / "tracked.txt").write_text("base\n")
    git(repo, "switch", "--detach", base)
    git(repo, "update-index", "--assume-unchanged", "tracked.txt")
    (repo / "tracked.txt").write_text("hidden authored edit\n")
    configure("hidden-index-edit-rejected", proj, root / "build-hidden", repo, expected=1)
    (repo / "tracked.txt").write_text("base\n")
    git(repo, "update-index", "--no-assume-unchanged", "tracked.txt")

    ordinary = root / "not-git"
    ordinary.mkdir()
    (ordinary / "private-work.txt").write_text("must not delete\n")
    nongit_proj = root / "nongit-project"
    project(nongit_proj, ordinary, base, repo)
    configure("non-git-directory-rejected", nongit_proj, root / "build-nongit", ordinary, expected=1)

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

(out / "results.json").write_text(json.dumps({"complete": True, "module_sha256": hashlib.sha256(module.read_bytes()).hexdigest(), "steps": steps}, indent=2) + "\n")
print(f"Passed {len(steps)} disposable preservation cases")
