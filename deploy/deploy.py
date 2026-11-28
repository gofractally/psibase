#!/usr/bin/env python3
"""One maintained way to bring a psibase deployment up and to change it (gofractally/psibase#2308).

    deploy.py <config.json> <mode> [arguments]

Modes
    status              every process of the deployment and whether it runs
    start | stop        the processes, under `systemd --user` units this script writes
    verify              checks from the node's side and through the proxy
    backup [--with-db]  keys, signer secrets, bridge state; with --with-db the node is
                        stopped, the database copied, and the node started again
    upgrade PKG...      installs changed packages from the build, signed with the block key
    boot                a new chain: refuses while the bridge of an existing chain holds funds
    record              appends what is deployed to deployments.jsonl

The configuration (inputs, in the repository) names a directory of secrets that is not in the
repository. This script reads secrets, never prints them and never creates them silently: `boot`
stops and says which file is missing.
"""
import http.client, json, os, shutil, subprocess, sys, time
from pathlib import Path


def die(message):
    print("deploy: " + message, file=sys.stderr)
    sys.exit(1)


class Deployment:
    def __init__(self, config_path):
        self.config = json.loads(Path(config_path).read_text())
        c = self.config
        expand = lambda p: Path(os.path.expanduser(p))
        self.root = expand(c["paths"]["root"])          # the deployment's own directory
        self.build = expand(c["paths"]["build"])        # a build tree of the commit named in the config
        self.secrets = expand(c["paths"]["secrets"])    # outside the repository
        self.host = c["host"]
        self.producer = c["producer"]
        self.listen = c["node"]["listen"]               # 127.0.0.1:port
        self.socket = self.root / "db" / "socket"
        self.cli = self.root / "bin" / "psibase"
        self.packages = self.root / "share" / "psibase" / "packages"
        self.units = Path(os.path.expanduser("~/.config/systemd/user"))

    # ---- small helpers -------------------------------------------------------------------
    def secret(self, name):
        path = self.secrets / name
        if not path.is_file():
            die(f"secret {path} is missing; it is not created for you")
        if path.stat().st_mode & 0o077:
            die(f"secret {path} must not be readable by others (chmod 600)")
        return path

    def api(self):
        return ["-a", f"http://{self.host}/", "--proxy", f"unix:{self.socket}"]

    def run(self, args, **kw):
        return subprocess.run([str(a) for a in args], **kw)

    def get(self, service, path, method="GET", body=None, headers=None, timeout=15):
        """A request as the operator: straight to the node, which lets a local client with this
        header and no forwarding headers past the sign-in gate."""
        h = {"Host": f"{service}.{self.host}" if service else self.host, "X-Psibase-Local": "1"}
        h.update(headers or {})
        # No redirects are followed: a node that is not booted yet answers with one.
        host, port = self.listen.split(":")
        connection = http.client.HTTPConnection(host, int(port), timeout=timeout)
        try:
            connection.request(method, path, body=body, headers=h)
            reply = connection.getresponse()
            return reply.status, reply.read()
        finally:
            connection.close()

    def graphql(self, service, query):
        status, body = self.get(service, "/graphql", "POST", query.encode(), {"Content-Type": "application/graphql"})
        if status != 200:
            die(f"{service} graphql answered {status}")
        reply = json.loads(body)
        if reply.get("errors"):
            die(f"{service} graphql: {reply['errors']}")
        return reply["data"]

    def push(self, actions, signers):
        keys = [part for s in signers for part in ("--sign", self.secret(s))]
        r = self.run([self.cli, "push", *self.api(), *keys, "--console=false", "--trace", "error", "-"],
                     input=json.dumps(actions), text=True, capture_output=True, timeout=120)
        if r.returncode:
            die("transaction refused: " + (r.stderr or r.stdout)[-600:])

    # ---- processes -----------------------------------------------------------------------
    def processes(self):
        """name -> (command, working directory). Everything the deployment keeps running."""
        c, root = self.config, self.root
        procs = {"node": ([root / "bin" / "psinode", "db", "--producer", self.producer, "--host", self.host,
                           "--http-timeout", str(c["node"].get("http_timeout", 75)),
                           "--listen", f"http://{self.listen}", "--listen", self.socket], root)}
        if c.get("proxy"):
            procs["proxy"] = ([os.path.expanduser(c["proxy"]["caddy"]), "run", "--config", root / "proxy" / "Caddyfile",
                               "--adapter", "caddyfile"], root / "proxy")
        for name, spec in c.get("services", {}).items():
            procs[name] = ([os.path.expanduser(a).replace("{root}", str(root)) for a in spec["command"]],
                           Path(os.path.expanduser(spec.get("cwd", str(root)).replace("{root}", str(root)))))
        return procs

    def unit(self, name):
        return f"psibase-{self.config['name'].replace('.', '-')}-{name}.service"

    def write_units(self):
        self.units.mkdir(parents=True, exist_ok=True)
        for name, (command, cwd) in self.processes().items():
            env = self.config.get("services", {}).get(name, {}).get("environment_file")
            text = "[Unit]\nDescription=%s %s\n%s\n[Service]\nWorkingDirectory=%s\nExecStart=%s\n%sRestart=always\nRestartSec=3\n\n[Install]\nWantedBy=default.target\n" % (
                self.config["name"], name, "" if name == "node" else f"After={self.unit('node')}\n",
                cwd, " ".join(str(a) for a in command),
                f"EnvironmentFile={os.path.expanduser(env).replace('{root}', str(self.root))}\n" if env else "")
            path = self.units / self.unit(name)
            if not path.exists() or path.read_text() != text:
                path.write_text(text)
        self.run(["systemctl", "--user", "daemon-reload"], check=True)

    def running(self, name):
        return self.run(["systemctl", "--user", "is-active", "--quiet", self.unit(name)]).returncode == 0

    def start(self, names=None):
        self.write_units()
        for name in names or self.processes():
            self.run(["systemctl", "--user", "enable", "--now", "--quiet", self.unit(name)], check=True)
            if name == "node":
                self.wait_node()

    def stop(self, names=None):
        for name in reversed(list(names or self.processes())):
            self.run(["systemctl", "--user", "disable", "--now", "--quiet", self.unit(name)])

    def wait_node(self, seconds=60):
        end = time.time() + seconds
        while time.time() < end:
            try:
                self.get("", "/common/chainid", timeout=3)
                return
            except OSError:
                time.sleep(1)
        die("the node did not answer")

    def status(self):
        linger = self.run(["loginctl", "show-user", os.environ.get("USER", ""), "-p", "Linger"], capture_output=True, text=True).stdout.strip()
        print(f"{self.config['name']}: units survive a logout only with lingering ({linger or 'Linger unknown'})")
        for name in self.processes():
            print(f"  {name:<12} {'running' if self.running(name) else 'NOT running'}")

    # ---- checks --------------------------------------------------------------------------
    def bridge(self):
        if "bridge" not in self.config:
            return None
        status, body = self.get("btcbridge", f"/snapshot?owner={self.config['bridge']['treasury']}")
        return json.loads(body) if status == 200 else None

    def verify(self):
        ok = True
        def check(what, passed, detail=""):
            nonlocal ok
            ok = ok and passed
            print(f"  {'ok  ' if passed else 'FAIL'} {what}{(': ' + detail) if detail else ''}")
        # Asked of a service's host: the root host only redirects to the network's home.
        status, body = self.get("accounts", "/common/chainid")
        check("node answers", status == 200, body.decode()[:20] if status == 200 else str(status))
        # A chain booted without a block key takes unsigned transactions from root.
        r = self.run([self.cli, "push", *self.api(), "--console=false", "--trace", "error", "-"], capture_output=True, text=True, timeout=60,
                     input=json.dumps([{"sender": "root", "service": "accounts", "method": "newAccount",
                                        "data": {"name": "zzunsigned1", "authService": "auth-any", "requireNew": False}}]))
        check("an unsigned transaction from root is refused", r.returncode != 0)
        name = self.graphql("branding", "{ networkName }")["networkName"]
        check("network name", name == self.config["network_name"], name)
        if self.config.get("guest", True):
            g = self.graphql("auth-sig", '{ account(name:"guest"){ owner{key} active{key} partner } }')["account"]
            check("guest account has one key and no recovery partner", bool(g) and g["owner"]["key"] == g["active"]["key"] and g["partner"] is None)
        proxy = self.config.get("proxy")
        if proxy:
            def outside(host, path="/", accept="text/html"):
                r = self.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code} %{redirect_url}", "-H", f"Accept: {accept}",
                              "--resolve", f"{host}:443:{proxy['public_ip']}", f"https://{host}{path}"], capture_output=True, text=True, timeout=30)
                return r.stdout.split(" ", 1)
            code, _ = outside(f"supervisor.{self.host}", "/sign-in.html")
            check("sign-in page is served through the proxy", code == "200", code)
            code, where = outside(f"{self.config['network_name']}.{self.host}")
            check("a signed-out visit is sent to sign-in", code == "302" and "sign-in" in where, f"{code} {where}")
            for host in proxy["operator_hosts"]:
                code, _ = outside(f"{host}.{self.host}")
                check(f"{host} is not reachable from outside", code == "404", code)
        b = self.bridge()
        if "bridge" in self.config:
            check("bridge answers", b is not None)
        if b:
            check("relay is not paused", not b["relay"]["paused"])
            check("bridge is not paused", not b["config"]["paused"])
            check("reserve equals liability", b["config"]["reserve"] == b["config"]["liability"],
                  f"{b['config']['reserve']} / {b['config']['liability']}")
            tip = self.config["bridge"].get("tip_command")
            if tip:
                height = int(self.run(["bash", "-c", os.path.expanduser(tip)], capture_output=True, text=True, timeout=30).stdout.strip() or 0)
                check("relay follows the Bitcoin tip", height - b["relay"]["height"] <= 2, f"relay {b['relay']['height']}, node {height}")
        for name in self.processes():
            check(f"{name} runs under its unit", self.running(name))
        return ok

    # ---- backup --------------------------------------------------------------------------
    def backup(self, with_db=False):
        target = Path(os.path.expanduser(self.config["paths"]["backups"])) / time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        target.mkdir(parents=True, mode=0o700)
        shutil.copytree(self.secrets, target / "secrets")
        for extra in self.config.get("backup", []):
            source = Path(os.path.expanduser(extra.replace("{root}", str(self.root))))
            if source.is_dir():
                shutil.copytree(source, target / source.name)
            elif source.exists():
                shutil.copy2(source, target / source.name)
        b = self.bridge()
        if b:
            (target / "bridge-snapshot.json").write_text(json.dumps(b))
        if with_db:
            # A copy of a running node's files is not a snapshot: stop, copy, start.
            others = [n for n in self.processes() if n != "node"]
            self.stop(others + ["node"])
            # Not the node's socket, which is not a file.
            shutil.copytree(self.root / "db", target / "db", ignore=lambda d, names: [n for n in names if (Path(d) / n).is_socket()])
            self.start(["node"] + others)
        for path in target.rglob("*"):
            path.chmod(0o700 if path.is_dir() else 0o600)
        print(target)
        return target

    # ---- upgrade -------------------------------------------------------------------------
    def install(self, names, local=False):
        for name in names:
            source = self.build / "share" / "psibase" / "packages" / f"{name}.psi"
            if not source.is_file():
                die(f"{source} is not built")
            kept = self.root / "previous-packages"
            kept.mkdir(exist_ok=True)
            if (self.packages / f"{name}.psi").exists():
                shutil.copy2(self.packages / f"{name}.psi", kept / f"{name}.psi")
            shutil.copy2(source, self.packages / f"{name}.psi")
        r = self.run([self.cli, "install", *self.api(), "--sign", self.secret("block.key.pem"), "--sign", self.secret(f"{self.producer}.key.pem"),
                      "--package-source", self.packages, *(["--local"] if local else []), "--reinstall", "-y", *names],
                     capture_output=True, text=True, timeout=900)
        if r.returncode:
            die(f"installing {' '.join(names)} failed: " + (r.stderr or r.stdout)[-600:])
        print("installed " + " ".join(names))

    def upgrade(self, names):
        if not names:
            die("upgrade which packages?")
        names = set(names)
        # Packages that only work together are installed together.
        for group in self.config.get("install_together", []):
            if names & set(group) and not set(group) <= names:
                print(f"adding {sorted(set(group) - names)}: installed together with {sorted(names & set(group))}")
                names |= set(group)
        before = self.bridge()
        local = [n for n in sorted(names) if n in self.config.get("local_packages", [])]
        chain = [n for n in sorted(names) if n not in local]
        if local:
            self.install(local, local=True)   # a local package is refused in an install with chain packages
        if chain:
            self.install(chain)
        if "Homepage" in names:
            # Its install script sets the network name back to "network".
            self.set_network_name()
        after = self.bridge()
        if before and after:
            keep = lambda s: json.dumps({k: s[k] for k in ("config", "requests", "batches", "utxos")}, sort_keys=True)
            if keep(before) != keep(after):
                die("the bridge's books changed across the upgrade: stop and look")
            print("bridge books identical before and after")
        self.record("upgrade " + " ".join(sorted(names)))

    def set_network_name(self):
        if self.graphql("branding", "{ networkName }")["networkName"] != self.config["network_name"]:
            self.push([{"sender": "branding", "service": "branding", "method": "setNetworkName",
                        "data": {"name": self.config["network_name"]}}], ["block.key.pem"])
            print("network name set to " + self.config["network_name"])

    # ---- boot ----------------------------------------------------------------------------
    def boot(self, force=False):
        if (self.root / "db").exists() and any((self.root / "db").iterdir()):
            b = self.bridge() if self.running("node") else None
            holds = b and (b["config"]["reserve"] or b["config"]["escrow"] or any(r["status"] in (0, 1, 4, 5) for r in b["requests"]))
            if holds:
                die("the bridge of the existing chain holds a reserve or open withdrawals: withdraw or sweep it first (README, 'Moving to a new chain')")
            if not force:
                die("a chain already exists here; boot --replace-existing-chain to discard it")
            self.backup(with_db=True)
            self.stop()
            shutil.move(str(self.root / "db"), str(self.root / f"db.replaced-{int(time.time())}"))
        block, producer = self.secret("block.key.pem"), self.secret(f"{self.producer}.key.pem")
        for d in ("bin", "share"):
            if (self.root / d).exists():
                shutil.rmtree(self.root / d)
        (self.root / "bin").mkdir(parents=True)
        for binary in ("psinode", "psitest"):
            shutil.copy2(self.build / binary, self.root / "bin" / binary)
        for binary in ("psibase", "cargo-psibase"):
            shutil.copy2(self.build / "rust" / "release" / binary, self.root / "bin" / binary)
        shutil.copytree(self.build / "share", self.root / "share")
        (self.root / "db").mkdir()
        self.start(["node"])
        # The operator holds the block key: the node is given it, it does not make one.
        der = lambda args: subprocess.run(["openssl", *args], check=True, capture_output=True).stdout
        private = der(["pkcs8", "-topk8", "-nocrypt", "-in", str(block), "-outform", "DER"]).hex().upper()
        public = der(["pkey", "-in", str(block), "-pubout", "-outform", "DER"])
        status, body = self.get("x-admin", "/native/admin/keys", "POST",
                                json.dumps({"service": self.config.get("block_key_verifier", "verify-k1"), "rawData": private}).encode(),
                                {"Content-Type": "application/json"})
        if status != 200 or public.hex().upper() not in body.decode().upper():
            die(f"the node did not take the block key ({status})")
        pub_der, pub_pem = self.root / "block.pub.der", self.root / f"{self.producer}.pub.pem"
        pub_der.write_bytes(public)
        pub_pem.write_bytes(der(["pkey", "-in", str(producer), "-pubout"]))
        r = self.run([self.cli, "boot", *self.api(), "-p", self.producer, "--block-key", pub_der, "-k", pub_pem,
                      "--package-source", self.packages, *self.config["packages"]["boot"]], capture_output=True, text=True, timeout=1800)
        if r.returncode:
            die("boot failed: " + (r.stderr or r.stdout)[-800:])
        time.sleep(5)
        sign = ["--sign", block, "--sign", producer]
        for name in self.config["packages"].get("after_boot", []):
            source = self.packages / f"{name}.psi"
            r = self.run([self.cli, "install", *self.api(), *sign, "-y", source], capture_output=True, text=True, timeout=900)
            if r.returncode:
                die(f"installing {name} failed: " + (r.stderr or r.stdout)[-600:])
        self.set_network_name()
        signup = self.config.get("signup")
        if signup:
            status, _ = self.get("x-signup", "/config", "PUT", self.secret(signup["config_secret"]).read_bytes(), {"Content-Type": "application/json"})
            if status not in (200, 204):
                die(f"x-signup did not take its configuration ({status})")
        self.start()
        self.record("boot")
        print("booted; run the deployment's own seeding steps next (README), then `verify`")

    # ---- record --------------------------------------------------------------------------
    def record(self, what):
        commit = self.run(["git", "-C", os.path.expanduser(self.config["paths"]["source"]), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        status, body = self.get("packages", "/graphql", "POST", b"{installed(first:500){edges{node{name version}}}}", {"Content-Type": "application/graphql"})
        installed = {e["node"]["name"]: e["node"]["version"] for e in json.loads(body)["data"]["installed"]["edges"]} if status == 200 else {}
        entry = {"when": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "what": what, "source_commit": commit,
                 "configured_commit": self.config.get("commit"), "packages": installed}
        with (self.root / "deployments.jsonl").open("a") as f:
            f.write(json.dumps(entry) + "\n")


def main():
    if len(sys.argv) < 3:
        die(__doc__)
    d, mode, args = Deployment(sys.argv[1]), sys.argv[2], sys.argv[3:]
    if mode == "status":
        d.status()
    elif mode == "start":
        d.start(args or None)
    elif mode == "stop":
        d.stop(args or None)
    elif mode == "verify":
        sys.exit(0 if d.verify() else 1)
    elif mode == "backup":
        d.backup("--with-db" in args)
    elif mode == "upgrade":
        d.upgrade(args)
    elif mode == "boot":
        d.boot("--replace-existing-chain" in args)
    elif mode == "record":
        d.record(" ".join(args) or "record")
    else:
        die("unknown mode " + mode)


if __name__ == "__main__":
    main()
