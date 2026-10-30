//! On-chain git repositories. See `git-on-psibase.md` in the repo root.

pub mod gitobj;

#[psibase::service_tables]
pub mod tables {
    use psibase::{AccountNumber, Pack, ToSchema, Unpack};
    use serde::{Deserialize, Serialize};

    #[table(name = "RepoTable", index = 0)]
    #[derive(Pack, Unpack, ToSchema, Serialize, Deserialize, Debug, Clone)]
    pub struct RepoRow {
        pub owner: AccountNumber,
        pub name: String,
        pub default_branch: String,
    }
    impl RepoRow {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, String) {
            (self.owner, self.name.clone())
        }
    }

    #[table(name = "WriterTable", index = 1)]
    #[derive(Pack, Unpack, ToSchema, Serialize, Deserialize, Debug, Clone)]
    pub struct WriterRow {
        pub owner: AccountNumber,
        pub name: String,
        pub account: AccountNumber,
        pub flags: u32,
    }
    impl WriterRow {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, String, AccountNumber) {
            (self.owner, self.name.clone(), self.account)
        }
    }

    #[table(name = "RefTable", index = 2)]
    #[derive(Pack, Unpack, ToSchema, Serialize, Deserialize, Debug, Clone)]
    pub struct RefRow {
        pub owner: AccountNumber,
        pub name: String,
        pub refname: String,
        /// 40-char lowercase hex SHA-1
        pub oid: String,
    }
    impl RefRow {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, String, String) {
            (self.owner, self.name.clone(), self.refname.clone())
        }
    }

    #[table(name = "ObjectTable", index = 3)]
    #[derive(Pack, Unpack, ToSchema, Serialize, Deserialize, Debug, Clone)]
    pub struct ObjectRow {
        /// 40-char lowercase hex SHA-1
        pub oid: String,
        /// zlib-compressed loose object, exactly what a dumb HTTP client fetches
        pub data: Vec<u8>,
    }
    impl ObjectRow {
        #[primary_key]
        fn pk(&self) -> String {
            self.oid.clone()
        }
    }
}

#[psibase::service(name = "git", tables = "tables")]
pub mod service {
    use crate::gitobj::{self, Kind, ZERO_OID};
    use crate::tables::*;
    use psibase::*;
    use serde::{Deserialize, Serialize};
    use std::collections::{BTreeSet, HashSet, VecDeque};

    pub const FLAG_UPDATE: u32 = 1;
    pub const FLAG_FORCE: u32 = 2;
    pub const FLAG_DELETE: u32 = 4;
    pub const FLAG_ALL: u32 = FLAG_UPDATE | FLAG_FORCE | FLAG_DELETE;

    #[derive(Pack, Unpack, ToSchema, Serialize, Deserialize, Debug, Clone)]
    pub struct GitObject {
        /// Claimed id, 40-char lowercase hex SHA-1
        pub oid: String,
        /// zlib-compressed loose object
        pub data: Hex<Vec<u8>>,
    }

    #[derive(Pack, Unpack, ToSchema, Serialize, Deserialize, Debug, Clone)]
    pub struct RefUpdate {
        pub refname: String,
        pub old_oid: String,
        pub new_oid: String,
    }

    fn fail(msg: &str) -> ! {
        abort_message(msg)
    }

    fn check_name(name: &str) {
        if name.is_empty()
            || name == "."
            || name == ".."
            || name.ends_with(".git")
            || !name
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'))
        {
            fail("invalid repo name");
        }
    }

    fn check_refname(r: &str) {
        let ok = r.starts_with("refs/")
            && r.len() > 5
            && !r.contains("..")
            && !r.contains("@{")
            && !r.contains("//")
            && !r.ends_with('/')
            && !r.ends_with(".lock")
            && !r.ends_with('.')
            && !r
                .bytes()
                .any(|c| c < 0x20 || c == 0x7f || b" ~^:?*[\\".contains(&c));
        if !ok {
            fail("invalid ref name");
        }
    }

    fn get_repo(owner: AccountNumber, name: &str) -> RepoRow {
        RepoTable::read()
            .get_index_pk()
            .get(&(owner, name.to_string()))
            .unwrap_or_else(|| fail("repo does not exist"))
    }

    fn flags_of(owner: AccountNumber, name: &str, who: AccountNumber) -> u32 {
        if who == owner {
            return FLAG_ALL;
        }
        WriterTable::read()
            .get_index_pk()
            .get(&(owner, name.to_string(), who))
            .map_or(0, |w| w.flags)
    }

    fn load(oid: &str) -> Option<gitobj::Object> {
        let row = ObjectTable::read().get_index_pk().get(&oid.to_string())?;
        Some(gitobj::decode(&row.data).unwrap_or_else(|e| fail(&e)).1)
    }

    fn need(oid: &str) -> gitobj::Object {
        load(oid).unwrap_or_else(|| fail(&format!("missing object {}", oid)))
    }

    /// True if `ancestor` is reachable from commit `tip` via parents.
    fn is_ancestor(ancestor: &str, tip: &str) -> bool {
        let mut seen = HashSet::new();
        let mut q = VecDeque::from([tip.to_string()]);
        while let Some(c) = q.pop_front() {
            if c == ancestor {
                return true;
            }
            if !seen.insert(c.clone()) {
                continue;
            }
            let o = need(&c);
            if o.kind != Kind::Commit {
                continue;
            }
            q.extend(gitobj::commit_parents(&o.content));
        }
        false
    }

    /// Check every object reachable from `tips` is stored, not descending
    /// into anything in `stop` (existing ref tips of this repo, whose
    /// closure was checked when they were written).
    fn check_closure(tips: &[String], stop: &HashSet<String>) {
        let mut seen: HashSet<String> = HashSet::new();
        let mut q: VecDeque<String> = tips.iter().cloned().collect();
        while let Some(oid) = q.pop_front() {
            if stop.contains(&oid) || !seen.insert(oid.clone()) {
                continue;
            }
            let o = need(&oid);
            match o.kind {
                Kind::Blob => {}
                Kind::Tree => {
                    q.extend(gitobj::tree_entries(&o.content).unwrap_or_else(|e| fail(&e)))
                }
                Kind::Commit => {
                    q.extend(gitobj::commit_tree(&o.content));
                    q.extend(gitobj::commit_parents(&o.content));
                }
                Kind::Tag => q.extend(gitobj::tag_target(&o.content)),
            }
        }
    }

    fn repo_refs(owner: AccountNumber, name: &str) -> Vec<RefRow> {
        RefTable::read()
            .get_index_pk()
            .range((owner, name.to_string(), String::new())..)
            .take_while(|r| r.owner == owner && r.name == name)
            .collect()
    }

    /// Create a repository owned by the sender.
    #[action]
    fn create(name: String) {
        check_name(&name);
        let owner = get_sender();
        let table = RepoTable::new();
        if table.get_index_pk().get(&(owner, name.clone())).is_some() {
            fail("repo already exists");
        }
        table
            .put(&RepoRow {
                owner,
                name,
                default_branch: "refs/heads/main".into(),
            })
            .unwrap();
    }

    /// Owner grants `flags` (1 update, 2 force, 4 delete) to `account`.
    #[action]
    #[allow(non_snake_case)]
    fn setWriter(name: String, account: AccountNumber, flags: u32) {
        let owner = get_sender();
        get_repo(owner, &name);
        if flags & !FLAG_ALL != 0 {
            fail("unknown flag bits");
        }
        WriterTable::new()
            .put(&WriterRow {
                owner,
                name,
                account,
                flags,
            })
            .unwrap();
    }

    #[action]
    #[allow(non_snake_case)]
    fn removeWriter(name: String, account: AccountNumber) {
        let owner = get_sender();
        get_repo(owner, &name);
        WriterTable::new().erase(&(owner, name, account));
    }

    /// Store zlib loose objects. Each is inflated, size-capped (1 MiB per
    /// object), hashed, and stored under its computed id.
    #[action]
    #[allow(non_snake_case)]
    fn putObjects(owner: AccountNumber, name: String, objects: Vec<GitObject>) {
        get_repo(owner, &name);
        if flags_of(owner, &name, get_sender()) & FLAG_UPDATE == 0 {
            fail("sender may not write to this repo");
        }
        let table = ObjectTable::new();
        for obj in objects {
            let (oid, _) = gitobj::decode(&obj.data.0).unwrap_or_else(|e| fail(&e));
            if oid != obj.oid {
                fail(&format!(
                    "object id mismatch: claimed {} computed {}",
                    obj.oid, oid
                ));
            }
            if table.get_index_pk().get(&oid).is_none() {
                table
                    .put(&ObjectRow {
                        oid,
                        data: obj.data.0,
                    })
                    .unwrap();
            }
        }
    }

    /// Compare-and-swap ref updates.
    #[action]
    #[allow(non_snake_case)]
    fn updateRefs(owner: AccountNumber, name: String, updates: Vec<RefUpdate>) {
        get_repo(owner, &name);
        let flags = flags_of(owner, &name, get_sender());
        let refs = RefTable::new();
        let stop: HashSet<String> = repo_refs(owner, &name).into_iter().map(|r| r.oid).collect();
        let mut new_tips = Vec::new();
        let mut seen_refs = BTreeSet::new();
        for u in &updates {
            check_refname(&u.refname);
            if !seen_refs.insert(u.refname.clone()) {
                fail("duplicate ref in update");
            }
            if !gitobj::is_oid(&u.old_oid) || !gitobj::is_oid(&u.new_oid) {
                fail("oids must be 40 lowercase hex chars");
            }
            let key = (owner, name.clone(), u.refname.clone());
            let cur = refs.get_index_pk().get(&key);
            let cur_oid = cur.as_ref().map_or(ZERO_OID, |r| r.oid.as_str());
            if cur_oid != u.old_oid {
                fail(&format!(
                    "stale old_oid for {}: current is {}",
                    u.refname, cur_oid
                ));
            }
            if u.new_oid == ZERO_OID {
                if flags & FLAG_DELETE == 0 {
                    fail("delete permission required");
                }
                continue;
            }
            if flags & FLAG_UPDATE == 0 {
                fail("update permission required");
            }
            let obj = need(&u.new_oid);
            if u.refname.starts_with("refs/heads/") && obj.kind != Kind::Commit {
                fail("branch must point at a commit");
            }
            let ff = u.old_oid == ZERO_OID
                || (obj.kind == Kind::Commit && is_ancestor(&u.old_oid, &u.new_oid));
            if !ff && flags & FLAG_FORCE == 0 {
                fail(&format!(
                    "non-fast-forward update of {} requires force",
                    u.refname
                ));
            }
            new_tips.push(u.new_oid.clone());
        }
        check_closure(&new_tips, &stop);
        for u in updates {
            let row = RefRow {
                owner,
                name: name.clone(),
                refname: u.refname,
                oid: u.new_oid,
            };
            if row.oid == ZERO_OID {
                refs.remove(&row);
            } else {
                refs.put(&row).unwrap();
            }
        }
    }

    fn reply(status: u16, ct: &str, body: Vec<u8>) -> Option<HttpReply> {
        Some(HttpReply {
            status,
            contentType: ct.into(),
            body: body.into(),
            headers: vec![HttpHeader::new("Cache-Control", "no-cache")],
        })
    }

    fn not_found() -> Option<HttpReply> {
        reply(404, "text/plain", b"not found\n".to_vec())
    }

    fn info_refs(owner: AccountNumber, name: &str) -> Vec<u8> {
        let mut out = String::new();
        // RefTable is ordered by refname bytes, i.e. C-locale order.
        for r in repo_refs(owner, name) {
            out.push_str(&format!("{}\t{}\n", r.oid, r.refname));
            let mut oid = r.oid.clone();
            let mut peeled = false;
            while let Some(o) = load(&oid) {
                if o.kind != Kind::Tag {
                    break;
                }
                match gitobj::tag_target(&o.content) {
                    Some(t) => {
                        oid = t;
                        peeled = true
                    }
                    None => break,
                }
            }
            if peeled {
                out.push_str(&format!("{}\t{}^{{}}\n", oid, r.refname));
            }
        }
        out.into_bytes()
    }

    /// Dumb HTTP: `/<owner>/<repo>[.git]/{HEAD,info/refs,objects/xx/yyyy}`.
    #[action]
    #[allow(non_snake_case)]
    fn serveSys(
        request: HttpRequest,
        _socket: Option<i32>,
        _user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        if request.method != "GET" && request.method != "HEAD" {
            return if request.target.contains("/git-") {
                not_found()
            } else {
                None
            };
        }
        let path = request.path().into_owned();
        let mut parts = path.trim_start_matches('/').splitn(3, '/');
        let (owner, repo, rest) = (parts.next()?, parts.next()?, parts.next()?);
        let owner = AccountNumber::from_exact(owner).ok()?;
        let repo = repo.strip_suffix(".git").unwrap_or(repo);
        let row = RepoTable::read()
            .get_index_pk()
            .get(&(owner, repo.to_string()));
        let Some(row) = row else { return not_found() };
        match rest {
            "HEAD" => reply(
                200,
                "text/plain",
                format!("ref: {}\n", row.default_branch).into_bytes(),
            ),
            "info/refs" => reply(200, "text/plain; charset=utf-8", info_refs(owner, repo)),
            _ => {
                let rest = rest.strip_prefix("objects/")?;
                let (a, b) = rest.split_once('/')?;
                let oid = format!("{}{}", a, b);
                if a.len() != 2 || !gitobj::is_oid(&oid) {
                    return not_found();
                }
                match ObjectTable::read().get_index_pk().get(&oid) {
                    Some(o) => reply(200, "application/x-git-loose-object", o.data),
                    None => not_found(),
                }
            }
        }
    }
}
