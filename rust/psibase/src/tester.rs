//! Wrapped native functions for tests to use
//!
//! Native functions give tests the ability to execute shell commands,
//! read files, create block chains, push transactions to those chains,
//! and control block production on those chains.
//!
//! These functions and types wrap the [Raw Native Functions](crate::tester_raw).

#![cfg_attr(not(target_family = "wasm"), allow(unused_imports, dead_code))]

use crate::{
    actions::login_action, check, create_boot_transactions, fetch_packages,
    get_optional_result_bytes, get_result_bytes, services, status_key, tester_raw, AccountNumber,
    Action, ActionFormatter, BlockTime, Caller, Checksum256, CodeByHashRow, CodeRow, DbId,
    DirectoryRegistry, Error, HostConfigRow, HttpBody, HttpHeader, HttpReply, HttpRequest,
    InnerTraceEnum, JointRegistry, KvHandle, KvMode, PackageOpFull, PackageRegistry,
    PackagedService, RunMode, Schema, SchemaFetcher, SchemaMap, Seconds, SignedTransaction,
    StatusRow, Table, TableRecord, Tapos, TimePointSec, TimePointUSec, ToKey, Transaction,
    TransactionBuilder, TransactionTrace,
};
#[cfg(target_family = "wasm")]
use crate::{MicroSeconds, PackageList};
use anyhow::anyhow;
use async_trait::async_trait;
use chrono::Utc;
use fracpack::{Pack, Unpack, UnpackOwned};
use futures::executor::block_on;
use psibase_macros::account_raw;
use serde::{de::DeserializeOwned, Deserialize};
use sha2::{Digest, Sha256};
use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufReader, Read, Seek};
use std::path::{Path, PathBuf};
use std::{marker::PhantomData, ptr::null_mut};

/// Execute a shell command
///
/// Returns the process exit code
pub fn execute(command: &str) -> i32 {
    unsafe { tester_raw::testerExecute(command.as_ptr(), command.len()) }
}

/// Block chain under test
#[derive(Debug)]
pub struct Chain {
    chain_handle: u32,
    status: RefCell<Option<StatusRow>>,
    producing: Cell<bool>,
    is_auto_block_start: bool,
    public: bool,
}

pub const PRODUCER_ACCOUNT: AccountNumber = AccountNumber::new(account_raw!("prod"));

impl Default for Chain {
    fn default() -> Self {
        Self::new()
    }
}

thread_local! {
    static NUM_PUBLIC_CHAINS: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
}

impl Drop for Chain {
    fn drop(&mut self) {
        unsafe { tester_raw::destroyChain(self.chain_handle) }
        if self.public {
            NUM_PUBLIC_CHAINS.with(|cell| {
                cell.set(cell.get() - 1);
            })
        }
        tester_raw::tester_clear_chain_for_db(self.chain_handle)
    }
}

// Following are stub functions for the linter (running in a non-wasm environment)
// can see that these functions exist; otherwise, tests show linter errors for valid calls.
#[cfg(not(target_family = "wasm"))]
impl Chain {
    pub fn new() -> Chain {
        unimplemented!();
    }
    pub fn push(&self, _transaction: &SignedTransaction) -> TransactionTrace {
        unimplemented!();
    }
    pub fn start_block(&self) {
        unimplemented!();
    }
}

#[cfg(target_family = "wasm")]
impl Chain {
    /// Create a new chain and make it active for database native functions.
    ///
    /// Shortcut for `Tester::create(1 << 27, 1 << 27, 1 << 27, 1 << 27)`
    pub fn new() -> Chain {
        Self::create(1 << 27, 1 << 27, 1 << 27, 1 << 27)
    }

    fn make_test_chain_prototype() -> Chain {
        let result = Chain::create_impl(1 << 27, 1 << 27, 1 << 27, 1 << 27, false);
        result.boot().unwrap();
        result
    }

    /// Returns a booted chain with TestDefault installed
    pub fn test_chain() -> Chain {
        thread_local! {
            static PROTOTYPE: Chain = Chain::make_test_chain_prototype();
        }
        println!("TESTER CREATE");
        let mut result = PROTOTYPE.with(|proto| Chain {
            chain_handle: unsafe { tester_raw::cloneChain(proto.chain_handle) },
            status: proto.status.clone(),
            producing: proto.producing.clone(),
            is_auto_block_start: proto.is_auto_block_start,
            public: true,
        });
        result.auto_select_chain();
        result.start_session();
        result.start_block();
        result
    }

    /// Boot the tester chain with default services being deployed
    pub fn boot(&self) -> Result<(), Error> {
        let default_services: Vec<String> = vec!["TestDefault".to_string()];
        self.boot_with(&Self::default_registry(), &default_services[..])
    }

    pub fn test_registry() -> JointRegistry<BufReader<File>> {
        let mut registry = JointRegistry::new();
        if let Ok(local_packages) = std::env::var("CARGO_PSIBASE_PACKAGE_PATH") {
            for path in local_packages.split(':') {
                registry.push(DirectoryRegistry::new(path.into())).unwrap();
            }
        }
        registry.push(Self::default_registry()).unwrap();
        registry
    }

    pub fn default_registry() -> DirectoryRegistry {
        let psibase_data_dir = std::env::var("PSIBASE_DATADIR")
            .expect("Cannot find package directory: PSIBASE_DATADIR not defined");
        let packages_dir = Path::new(&psibase_data_dir).join("packages");
        DirectoryRegistry::new(packages_dir)
    }

    pub fn boot_with<R: PackageRegistry>(&self, reg: &R, services: &[String]) -> Result<(), Error> {
        let mut services = block_on(reg.resolve(services, false))?;

        const COMPRESSION_LEVEL: u32 = 4;
        let (boot_tx, subsequent_tx) = create_boot_transactions(
            &None,
            &None,
            PRODUCER_ACCOUNT,
            false,
            TimePointSec { seconds: 10 },
            &mut services[..],
            COMPRESSION_LEVEL,
        )
        .unwrap();

        for trx in boot_tx {
            self.push(&trx).ok()?;
        }

        self.start_block();

        for (_, group, _) in subsequent_tx {
            for trx in group {
                self.push(&trx).ok()?;
            }
        }

        self.start_block();

        Ok(())
    }

    fn auto_select_chain(&mut self) {
        if self.public {
            let first = NUM_PUBLIC_CHAINS.with(|n| {
                let old = n.get();
                n.set(old + 1);
                old == 0
            });
            if first {
                self.select_chain()
            }
        }
    }

    /// Create a new chain and make it active for database native functions.
    ///
    /// The arguments are the file sizes in bytes for the database's
    /// various files.
    pub fn create(hot_bytes: u64, warm_bytes: u64, cool_bytes: u64, cold_bytes: u64) -> Chain {
        println!("TESTER CREATE");
        Self::create_impl(hot_bytes, warm_bytes, cool_bytes, cold_bytes, true)
    }
    fn create_impl(
        hot_bytes: u64,
        warm_bytes: u64,
        cool_bytes: u64,
        cold_bytes: u64,
        public: bool,
    ) -> Chain {
        let chain_handle =
            unsafe { tester_raw::createChain(hot_bytes, warm_bytes, cool_bytes, cold_bytes) };
        let mut result = Chain {
            chain_handle,
            status: None.into(),
            producing: false.into(),
            is_auto_block_start: true,
            public,
        };
        result.auto_select_chain();
        result.load_local_services();
        result.start_session();
        result
    }

    fn load_local_services(&mut self) {
        use crate::{CODE_TABLE, NATIVE_TABLE_PRIMARY_INDEX};
        let prefix = (CODE_TABLE, NATIVE_TABLE_PRIMARY_INDEX).to_key();
        if unsafe {
            tester_raw::kvGreaterEqual(
                self.chain_handle,
                DbId::NativeSubjective,
                prefix.as_ptr(),
                prefix.len() as u32,
                prefix.len() as u32,
            )
        } != u32::MAX
        {
            return;
        }

        let packages_root: PathBuf = std::env::var_os("PSIBASE_DATADIR")
            .expect("Cannot find local service directory")
            .into();
        let packages_dir = packages_root.join("packages");
        let registry = DirectoryRegistry::new(packages_dir);
        let package_names = vec!["XDefault".to_string()];
        let packages = block_on(registry.resolve(&package_names, true)).unwrap();
        let mut requests = Vec::new();
        let mut early_requests = Vec::new();
        unsafe {
            tester_raw::checkoutSubjective(self.chain_handle);
        }
        let root_host = "\0";
        for mut package in packages {
            for (account, info, code) in package.services() {
                let hash: [u8; 32] = Sha256::digest(&code).into();
                let code_hash: Checksum256 = hash.into();

                let code_row = CodeRow {
                    codeNum: *account,
                    flags: info.parse_flags(),
                    codeHash: code_hash.clone(),
                    vmType: 0,
                    vmVersion: 0,
                };
                let key = code_row.key();
                self.kv_put(DbId::NativeSubjective, &key, &code_row);
                let code_by_hash_row = CodeByHashRow {
                    codeHash: code_hash,
                    vmType: 0,
                    vmVersion: 0,
                    code: code.into(),
                };
                let key = code_by_hash_row.key();
                self.kv_put(DbId::NativeSubjective, &key, &code_by_hash_row);

                if let Some(server) = &info.server {
                    let body: Vec<u8> =
                        serde_json::to_string(&services::x_http::RegisterServerRequest {
                            service: *account,
                            server: *server,
                        })
                        .unwrap()
                        .into();
                    let req = HttpRequest {
                        host: services::x_http::SERVICE.to_string() + "." + root_host,
                        method: "POST".to_string(),
                        target: "/register_server".to_string(),
                        contentType: "application/json".to_string(),
                        headers: vec![],
                        body: body.into(),
                    };
                    if account == &services::x_packages::SERVICE {
                        early_requests.push(req);
                    } else {
                        requests.push(req);
                    }
                }
            }

            for (account, path, file) in package.data() {
                let Some(mime_type) = mime_guess::from_path(&path).first() else {
                    panic!("Cannot determine Mime-Type for {}", path)
                };
                requests.push(HttpRequest {
                    host: account.to_string() + "." + root_host,
                    method: "PUT".to_string(),
                    target: path,
                    contentType: mime_type.to_string(),
                    headers: Vec::new(),
                    body: file.into(),
                });
            }
            requests.push(HttpRequest {
                host: services::x_packages::SERVICE.to_string() + "." + root_host,
                method: "PUT".to_string(),
                target: format!("/manifest/{}", package.hash()),
                contentType: "application/json".to_string(),
                headers: vec![],
                body: serde_json::to_string(&package.manifest())
                    .unwrap()
                    .into_bytes()
                    .into(),
            });
            requests.push(HttpRequest {
                host: services::x_packages::SERVICE.to_string() + "." + root_host,
                method: "POST".to_string(),
                target: "/postinstall".to_string(),
                contentType: "application/json".to_string(),
                headers: vec![],
                body: serde_json::to_string(
                    &package.meta().info(package.hash().clone(), String::new()),
                )
                .unwrap()
                .into_bytes()
                .into(),
            });
        }
        check(
            unsafe { tester_raw::commitSubjective(self.chain_handle) },
            "Failed to commit changes",
        );
        for request in early_requests {
            let reply = self.http(&request).unwrap();
            if reply.status != 200 {
                panic!(
                    "{} {} failed: {}",
                    request.method,
                    request.target,
                    reply.text().unwrap()
                );
            }
        }
        for request in requests {
            let reply = self.http(&request).unwrap();
            if reply.status != 200 {
                panic!("PUT failed: {}", reply.text().unwrap());
            }
        }
    }

    fn start_session(&mut self) {
        let row = HostConfigRow {
            hostVersion: format!("psitest-{}", env!("CARGO_PKG_VERSION")),
            config: r#"{"host":{"hosts":["psibase.io"]}}"#.to_string(),
        };

        unsafe {
            tester_raw::checkoutSubjective(self.chain_handle);
        }
        self.kv_put(DbId::NativeSession, &row.key(), &row);
        check(
            unsafe { tester_raw::commitSubjective(self.chain_handle) },
            "Failed to commit changes",
        );
        let trace = self.run_action(
            RunMode::RPC,
            true,
            services::x_http::Wrapper::pack_from(AccountNumber::default()).startSession(),
        );
        ChainEmptyResult { trace }.get().unwrap()
    }

    /// Advance the blockchain time by the specified number of microseconds and start a new block.
    ///
    /// This method increments the current block time by `seconds` and starts a new block at that time.
    /// If no current block exists, it starts from a default time (e.g., 0 microseconds).
    pub fn start_block_after(&self, micro_seconds: MicroSeconds) {
        // Scope the immutable borrow to ensure it’s dropped before calling start_block_at
        let current_time = {
            let status = self.status.borrow();
            status
                .as_ref()
                .map(|s| s.current.time)
                .unwrap_or(TimePointUSec { microseconds: 0 })
        };
        self.start_block_at(current_time + micro_seconds);
    }

    /// Start a new block
    ///
    /// Starts a new block at `time`. If `time.seconds` is 0,
    /// then starts a new block 1 second after the most recent.
    pub fn start_block_at(&self, time: BlockTime) {
        let status = &mut *self.status.borrow_mut();

        let (producer, term, mut commit_num) = if let Some(status) = status {
            let producers = if let Some(next) = &status.consensus.next {
                if status.current.commitNum < next.blockNum {
                    status.consensus.current.data.producers()
                } else {
                    next.consensus.data.producers()
                }
            } else {
                status.consensus.current.data.producers()
            };
            (
                if producers.is_empty() {
                    AccountNumber::from("firstproducer")
                } else {
                    producers[0].name
                },
                status.current.term,
                status.head.as_ref().map_or(0, |head| head.header.blockNum),
            )
        } else {
            (AccountNumber::from("firstproducer"), 0, 0)
        };

        // Guarantee that there is a recent block for fillTapos to use.
        if let Some(status) = status {
            if status.current.time + Seconds::new(1) < time {
                unsafe {
                    tester_raw::startBlock(
                        self.chain_handle,
                        (time - Seconds::new(1)).microseconds,
                        producer.value,
                        term,
                        commit_num,
                    )
                }
                commit_num += 1;
            }
        }
        unsafe {
            tester_raw::startBlock(
                self.chain_handle,
                time.microseconds,
                producer.value,
                term,
                commit_num,
            )
        }
        *status = self
            .kv_get::<StatusRow, _>(StatusRow::DB, &status_key())
            .unwrap();
        self.producing.replace(true);
    }

    /// Start a new block
    ///
    /// Starts a new block 1 second after the most recent.
    pub fn start_block(&self) {
        self.start_block_after(Seconds::new(1).into())
    }

    /// Finish a block
    ///
    /// This does nothing if a block isn't currently being produced.
    pub fn finish_block(&self) {
        unsafe { tester_raw::finishBlock(self.chain_handle) }
        self.producing.replace(false);
    }

    /// By default, the TestChain will automatically advance blocks.
    /// When disabled, the the chain will only advance blocks manually.
    /// To manually advance a block, call start_block.
    pub fn set_auto_block_start(&mut self, enable: bool) {
        self.is_auto_block_start = enable;
    }

    /// Push a transaction
    ///
    /// The returned trace includes detailed information about the execution,
    /// including whether it succeeded, and the cause if it failed.
    pub fn push(&self, transaction: &SignedTransaction) -> TransactionTrace {
        if !self.producing.get() {
            self.start_block();
        }

        let transaction = transaction.packed();
        let size = unsafe {
            tester_raw::pushTransaction(self.chain_handle, transaction.as_ptr(), transaction.len())
        };
        TransactionTrace::unpacked(&get_result_bytes(size)).unwrap()
    }

    pub fn run_action(&mut self, mode: RunMode, head: bool, action: Action) -> TransactionTrace {
        let packed = action.packed();
        let size = unsafe {
            tester_raw::runAction(self.chain_handle, mode, head, packed.as_ptr(), packed.len())
        };
        TransactionTrace::unpacked(&get_result_bytes(size)).unwrap()
    }

    /// Copy database to `path`
    ///
    /// Runs the following shell command: `mkdir -p {path} && cp -a {src}/* {path}`,
    /// where `{path}` is the passed-in argument and `{src}` is the chain's database.
    ///
    /// Returns shell exit status; 0 if successful
    pub fn copy_database(&self, path: &str) -> i32 {
        let src = unsafe { self.get_path() };
        execute(&format! {"mkdir -p {path} && cp -a {src}/* {path}", src = src, path = path})
    }

    /// Get filesystem path of chain's database
    ///
    /// See [`copy_database`](Self::copy_database) for the most-common use case
    ///
    /// # Safety
    ///
    /// It is safe to copy the files to another location on the filesystem. However,
    /// modifying the original files or launching `psinode` on the original files
    /// will corrupt the database and likely crash the `psitest` process running this
    /// wasm.
    pub unsafe fn get_path(&self) -> String {
        let size = tester_raw::getChainPath(self.chain_handle, null_mut(), 0);
        let mut bytes = Vec::with_capacity(size);
        tester_raw::getChainPath(self.chain_handle, bytes.as_mut_ptr(), size);
        bytes.set_len(size);
        String::from_utf8_unchecked(bytes)
    }

    /// Select chain for database native functions
    ///
    /// After you call `select_chain`, the following functions will use
    /// this chain's database:
    ///
    /// * [`native_raw::kvGet`](crate::native_raw::kvGet)
    /// * [`native_raw::getSequential`](crate::native_raw::getSequential)
    /// * [`native_raw::kvGreaterEqual`](crate::native_raw::kvGreaterEqual)
    /// * [`native_raw::kvLessThan`](crate::native_raw::kvLessThan)
    /// * [`native_raw::kvMax`](crate::native_raw::kvMax)
    pub fn select_chain(&self) {
        tester_raw::tester_select_chain_for_db(self.chain_handle)
    }

    pub fn open<R: TableRecord, T: Table<R>>(&self) -> T {
        let prefix = (T::SERVICE, T::TABLE_INDEX).to_key();
        let handle = unsafe {
            KvHandle::from_raw(polyfill::open_in_chain(
                self.chain_handle,
                R::DB,
                prefix,
                KvMode::Read,
            ))
        };
        T::from_handle(handle)
    }

    pub fn kv_get_bytes(&self, db: DbId, key: &[u8]) -> Option<Vec<u8>> {
        let size =
            unsafe { tester_raw::kvGet(self.chain_handle, db, key.as_ptr(), key.len() as u32) };
        get_optional_result_bytes(size)
    }

    pub fn kv_get<V: UnpackOwned, K: ToKey>(
        &self,
        db: DbId,
        key: &K,
    ) -> Result<Option<V>, fracpack::Error> {
        if let Some(v) = self.kv_get_bytes(db, &key.to_key()) {
            Ok(Some(V::unpacked(&v)?))
        } else {
            Ok(None)
        }
    }

    /// Set a key-value pair
    ///
    /// If key already exists, then replace the existing value.
    pub fn kv_put_bytes(&mut self, db: DbId, key: &[u8], value: &[u8]) {
        unsafe {
            tester_raw::kvPut(
                self.chain_handle,
                db,
                key.as_ptr(),
                key.len() as u32,
                value.as_ptr(),
                value.len() as u32,
            )
        }
    }

    /// Set a key-value pair
    ///
    /// If key already exists, then replace the existing value.
    pub fn kv_put<K: ToKey, V: Pack>(&mut self, db: DbId, key: &K, value: &V) {
        self.kv_put_bytes(db, &key.to_key(), &value.packed())
    }

    /// Create a new account
    ///
    /// Create a new account which authenticates using `auth-any`.
    /// Doesn't fail if the account already exists.
    pub fn new_account(&self, account: AccountNumber) -> Result<(), anyhow::Error> {
        services::accounts::Wrapper::push(self)
            .newAccount(account, AccountNumber::new(account_raw!("auth-any")), false)
            .get()
    }

    /// Deploy a service
    ///
    /// Set code on an account. Also creates the account if needed.
    pub fn deploy_service(&self, account: AccountNumber, code: &[u8]) -> Result<(), anyhow::Error> {
        self.new_account(account)?;
        // TODO: update setcode::setCode to not need a vec. Needs changes to the service macro.
        services::setcode::Wrapper::push_from(self, account)
            .setCode(account, 0, 0, code.to_vec().into())
            .get()
    }

    fn push_transactions(
        &self,
        transactions: Vec<(String, Vec<Vec<Action>>, bool)>,
    ) -> Result<(), anyhow::Error> {
        for (_label, group, _carry) in transactions {
            for actions in group {
                let mut trx = Transaction {
                    tapos: Default::default(),
                    actions: actions,
                    claims: vec![],
                };
                self.fill_tapos(&mut trx, 2);
                let trace = self.push(&SignedTransaction {
                    transaction: trx.packed().into(),
                    proofs: Default::default(),
                    subjectiveData: None,
                });
                ChainEmptyResult { trace }.get()?
            }
        }
        Ok(())
    }

    fn load_schemas<R: Read + Seek>(
        &self,
        package: &mut PackagedService<R>,
        schemas: &mut SchemaMap,
    ) -> Result<(), anyhow::Error> {
        use crate::Table;
        package.get_all_schemas(schemas)?;
        let mut required = HashSet::new();
        package.get_required_schemas(&mut required)?;
        let index = self
            .open::<services::packages::InstalledSchema, services::packages::InstalledSchemaTable>()
            .get_index_pk();
        for account in required {
            if !schemas.contains_key(&account) {
                let Some(schema) = index.get(&account) else {
                    Err(anyhow!("Could not find schema for {account}"))?
                };
                schemas.insert(account, schema.schema);
            }
        }
        Ok(())
    }

    pub fn install<R: PackageRegistry>(
        &self,
        reg: &R,
        packages: &[String],
    ) -> Result<(), anyhow::Error> {
        use crate::Table;
        let installed_table = self.open::<services::packages::InstalledPackage, services::packages::InstalledPackageTable>();
        let mut installed = PackageList::new();
        for p in &installed_table.get_index_pk() {
            installed.insert_installed(p)
        }
        let packages = block_on(installed.resolve_changes(reg, packages, false, false))?;
        let packages = block_on(fetch_packages(reg, packages, &installed))?;
        let updated_packages = installed.into_updated(&packages);

        let mut schemas = SchemaMap::new();
        let sender = services::producers::ROOT;
        const TARGET_SIZE: usize = 1024 * 1024;
        const COMPRESSION_LEVEL: u32 = 4;
        for op in packages {
            match op {
                PackageOpFull::Install(mut package) => {
                    let mut builder = TransactionBuilder::new(TARGET_SIZE, |actions| Ok(actions));
                    self.load_schemas(&mut package, &mut schemas)?;
                    builder.set_label(format!(
                        "Installing {}-{}",
                        package.name(),
                        package.version()
                    ));
                    let mut account_actions = vec![];
                    package.install_accounts(&mut account_actions, None, sender, &None)?;
                    builder.push_all(account_actions)?;
                    let mut actions = vec![];
                    package.install(
                        &mut actions,
                        None,
                        sender,
                        true,
                        COMPRESSION_LEVEL,
                        &mut schemas,
                        &updated_packages,
                    )?;
                    builder.push_all(actions)?;

                    self.push_transactions(builder.finish()?)?;
                }
                _ => {
                    unimplemented!("Replacing or removing packages")
                }
            }
        }
        Ok(())
    }

    pub fn http(&self, request: &HttpRequest) -> Result<HttpReply, anyhow::Error> {
        let packed_request = request.packed();
        let fd = unsafe {
            tester_raw::httpRequest(
                self.chain_handle,
                packed_request.as_ptr(),
                packed_request.len(),
            )
        };
        let mut size: u32 = 0;
        let err = unsafe { tester_raw::socketRecv(fd, &mut size) };
        if err != 0 {
            Err(anyhow!("Could not read response: {}", err))?;
        }

        Ok(HttpReply::unpacked(&get_result_bytes(size))?)
    }

    pub fn get(&self, account: AccountNumber, target: &str) -> Result<HttpReply, anyhow::Error> {
        self.get_auth(account, target, "")
    }

    pub fn post(
        &self,
        account: AccountNumber,
        target: &str,
        data: HttpBody,
    ) -> Result<HttpReply, anyhow::Error> {
        self.post_auth(account, target, data, "")
    }

    pub fn graphql<T: DeserializeOwned>(
        &self,
        account: AccountNumber,
        query: &str,
    ) -> Result<T, anyhow::Error> {
        self.graphql_auth(account, query, "")
    }

    pub fn get_auth(
        &self,
        account: AccountNumber,
        target: &str,
        token: &str,
    ) -> Result<HttpReply, anyhow::Error> {
        let mut headers = Vec::new();
        if !token.is_empty() {
            headers.push(HttpHeader::new(
                "Authorization",
                &format!("Bearer {}", token),
            ));
        }
        self.http(&HttpRequest {
            host: format!("{}.psibase.io", account),
            method: "GET".into(),
            target: target.into(),
            contentType: "".into(),
            body: <Vec<u8>>::new().into(),
            headers,
        })
    }

    pub fn post_auth(
        &self,
        account: AccountNumber,
        target: &str,
        data: HttpBody,
        token: &str,
    ) -> Result<HttpReply, anyhow::Error> {
        let mut headers = Vec::new();
        if !token.is_empty() {
            headers.push(HttpHeader::new(
                "Authorization",
                &format!("Bearer {}", token),
            ));
        }
        self.http(&HttpRequest {
            host: format!("{}.psibase.io", account),
            method: "POST".into(),
            target: target.into(),
            contentType: data.contentType,
            body: data.body,
            headers,
        })
    }

    pub fn graphql_auth<T: DeserializeOwned>(
        &self,
        account: AccountNumber,
        query: &str,
        token: &str,
    ) -> Result<T, anyhow::Error> {
        self.post_auth(account, "/graphql", HttpBody::graphql(query), token)?
            .json()
    }

    pub fn login(
        &self,
        user: AccountNumber,
        service: AccountNumber,
    ) -> Result<String, anyhow::Error> {
        let expiration = TimePointSec::from(Utc::now()) + Seconds::new(10);

        let tapos = Tapos {
            expiration,
            refBlockSuffix: 0,
            flags: Tapos::DO_NOT_BROADCAST_FLAG,
            refBlockIndex: 0,
        };

        let trx = Transaction {
            tapos,
            actions: vec![login_action(user, service, "psibase.io")],
            claims: vec![],
        };

        let strx = SignedTransaction {
            transaction: trx.packed().into(),
            proofs: vec![],
            subjectiveData: None,
        };

        let reply = self.post(
            services::transact::SERVICE,
            "/login",
            HttpBody {
                contentType: "application/octet-stream".into(),
                body: strx.packed().into(),
            },
        )?;

        #[derive(Deserialize)]
        struct LoginReply {
            access_token: String,
        }

        let login_reply: LoginReply = reply.json()?;
        Ok(login_reply.access_token)
    }

    pub fn display_trace<'a>(&'a self, trace: &'a TransactionTrace) -> ChainDisplayTrace<'a> {
        ChainDisplayTrace { chain: self, trace }
    }
}

impl Chain {
    /// Fill tapos fields
    ///
    /// `expire_seconds` is relative to the most-recent block.
    pub fn fill_tapos(&self, trx: &mut Transaction, expire_seconds: u32) {
        trx.tapos.expiration.seconds = expire_seconds as i64;
        trx.tapos.refBlockIndex = 0;
        trx.tapos.refBlockSuffix = 0;
        if let Some(status) = &*self.status.borrow() {
            trx.tapos.expiration =
                status.current.time.seconds() + Seconds::new(expire_seconds as i64);
            if let Some(head) = &status.head {
                let mut suffix = [0; 4];
                suffix.copy_from_slice(&head.blockId[head.blockId.len() - 4..]);
                trx.tapos.refBlockIndex = (head.header.blockNum & 0x7f) as u8;
                trx.tapos.refBlockSuffix = u32::from_le_bytes(suffix);
            }
        }
    }
}

#[cfg(target_family = "wasm")]
pub struct ChainDisplayTrace<'a> {
    chain: &'a Chain,
    trace: &'a TransactionTrace,
}

#[cfg(target_family = "wasm")]
impl<'a> std::fmt::Display for ChainDisplayTrace<'a> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let formatter = ActionFormatter::new(ChainSchemaFetcher { chain: self.chain });
        let _ = block_on(formatter.prepare_transaction_trace(self.trace));
        write!(f, "{}", formatter.display_transaction_trace(self.trace))
    }
}

#[cfg(target_family = "wasm")]
struct ChainSchemaFetcher<'a> {
    chain: &'a Chain,
}

#[cfg(target_family = "wasm")]
#[async_trait(?Send)]
impl<'a> SchemaFetcher for ChainSchemaFetcher<'a> {
    async fn fetch_schema(&self, service: AccountNumber) -> Result<Schema, anyhow::Error> {
        let index = self
            .chain
            .open::<services::packages::InstalledSchema, services::packages::InstalledSchemaTable>()
            .get_index_pk();
        index
            .get(&service)
            .map(|row| row.schema)
            .ok_or_else(|| anyhow!("Could not find schema for {service}"))
    }
}

pub struct ChainEmptyResult {
    pub trace: TransactionTrace,
}

impl ChainEmptyResult {
    pub fn get(&self) -> Result<(), anyhow::Error> {
        if let Some(e) = &self.trace.error {
            Err(anyhow!("{}", e))
        } else {
            Ok(())
        }
    }

    pub fn match_error(self, msg: &str) -> Result<TransactionTrace, anyhow::Error> {
        self.trace.match_error(msg)
    }
}

pub struct ChainResult<T: fracpack::UnpackOwned> {
    pub trace: TransactionTrace,
    _marker: PhantomData<T>,
}

impl<T: fracpack::UnpackOwned> ChainResult<T> {
    pub fn get(&self) -> Result<T, anyhow::Error> {
        self.get_with_debug(false)
    }

    fn is_user_action(act: &Action) -> bool {
        use crate::{
            self as psibase, method,
            services::{cpu_limit, db, events, transact, virtual_server},
        };
        !(act.service == db::SERVICE && act.method == method!("open")
            || act.service == cpu_limit::SERVICE
            || act.sender == transact::SERVICE && act.service == virtual_server::SERVICE
            || act.service == events::SERVICE && act.method == method!("sync")
            || act.sender == AccountNumber::default())
    }

    pub fn get_with_debug(&self, debug: bool) -> Result<T, anyhow::Error> {
        if let Some(e) = &self.trace.error {
            return Err(anyhow!("{}", e));
        }
        if let Some(transact) = self.trace.action_traces.last() {
            let ret = transact
                .inner_traces
                .iter()
                // TODO: improve this filter.. we need to return whatever is the name of the action somehow if possible...
                .filter_map(|inner| {
                    if let InnerTraceEnum::ActionTrace(at) = &inner.inner {
                        if !Self::is_user_action(&at.action) {
                            return None;
                        }
                        if debug {
                            println!(
                                ">>> ChainResult::get - Inner action trace: {} (raw_retval={})",
                                at.action.method, at.raw_retval
                            );
                        }
                        if at.raw_retval.is_empty() {
                            return None;
                        } else {
                            Some(&at.raw_retval)
                        }
                    } else {
                        None
                    }
                })
                .next();
            if let Some(ret) = ret {
                if debug {
                    println!(">>> ChainResult::get - Unpacking ret: `{}`", ret);
                }
                let unpacked_ret = T::unpacked(ret)?;
                return Ok(unpacked_ret);
            }
        }
        Err(anyhow!("Can't find action in trace"))
    }

    pub fn match_error(self, msg: &str) -> Result<TransactionTrace, anyhow::Error> {
        self.trace.match_error(msg)
    }
}

#[derive(Clone, Debug)]
pub struct ChainPusher<'a> {
    pub chain: &'a Chain,
    pub sender: AccountNumber,
    pub service: AccountNumber,
}

impl<'a> Caller for ChainPusher<'a> {
    type ReturnsNothing = ChainEmptyResult;
    type ReturnType<T: fracpack::UnpackOwned> = ChainResult<T>;

    fn call_returns_nothing<Args: fracpack::Pack>(
        &self,
        method: crate::MethodNumber,
        args: Args,
    ) -> Self::ReturnsNothing {
        let mut trx = Transaction {
            tapos: Default::default(),
            actions: vec![Action {
                sender: self.sender,
                service: self.service,
                method,
                rawData: args.packed().into(),
            }],
            claims: vec![],
        };
        self.chain.fill_tapos(&mut trx, 2);
        let trace = self.chain.push(&SignedTransaction {
            transaction: trx.packed().into(),
            proofs: Default::default(),
            subjectiveData: None,
        });

        if self.chain.is_auto_block_start {
            self.chain.start_block();
        }

        ChainEmptyResult { trace }
    }

    fn call<Ret: fracpack::UnpackOwned, Args: fracpack::Pack>(
        &self,
        method: crate::MethodNumber,
        args: Args,
    ) -> Self::ReturnType<Ret> {
        let mut trx = Transaction {
            tapos: Default::default(),
            actions: vec![Action {
                sender: self.sender,
                service: self.service,
                method,
                rawData: args.packed().into(),
            }],
            claims: vec![],
        };
        self.chain.fill_tapos(&mut trx, 2);
        let trace = self.chain.push(&SignedTransaction {
            transaction: trx.packed().into(),
            proofs: Default::default(),
            subjectiveData: None,
        });
        let ret = ChainResult::<Ret> {
            trace,
            _marker: Default::default(),
        };

        if self.chain.is_auto_block_start {
            self.chain.start_block();
        }

        ret
    }
}

#[cfg(target_family = "wasm")]
#[allow(non_snake_case)]
pub mod polyfill {
    use crate::native_raw::{KvHandle, KvMode};
    use crate::tester_raw;
    use crate::tester_raw::get_selected_chain;
    use crate::DbId;

    struct KvBucket {
        chain_handle: u32,
        db: DbId,
        prefix: Vec<u8>,
        _mode: KvMode,
    }
    impl KvBucket {
        unsafe fn new<'a>(
            chain_handle: u32,
            db: DbId,
            prefix: Vec<u8>,
            mode: KvMode,
        ) -> &'a mut KvBucket {
            let ptr = std::alloc::alloc(std::alloc::Layout::new::<KvBucket>()) as *mut KvBucket;
            assert!(!ptr.is_null());
            ptr.write(KvBucket {
                chain_handle,
                db,
                prefix,
                _mode: mode,
            });
            &mut *ptr
        }
        unsafe fn key(&self, key: *const u8, len: u32) -> Vec<u8> {
            let mut result = Vec::with_capacity(self.prefix.len() + len as usize);
            result.extend_from_slice(&self.prefix);
            result.extend_from_slice(std::slice::from_raw_parts(key, len as usize));
            return result;
        }
        unsafe fn handle(&self) -> KvHandle {
            KvHandle(self as *const KvBucket as usize as u32)
        }
        unsafe fn from_handle<'a>(handle: KvHandle) -> &'a mut KvBucket {
            &mut *(handle.0 as usize as *mut KvBucket)
        }
    }

    pub(crate) unsafe fn open_in_chain(
        chain_handle: u32,
        db: DbId,
        prefix: Vec<u8>,
        mode: KvMode,
    ) -> KvHandle {
        KvBucket::new(chain_handle, db, prefix, mode).handle()
    }

    pub unsafe fn kvOpen(db: DbId, prefix: *const u8, len: u32, mode: KvMode) -> KvHandle {
        KvBucket::new(
            get_selected_chain(),
            db,
            std::slice::from_raw_parts(prefix, len as usize).to_owned(),
            mode,
        )
        .handle()
    }

    pub unsafe fn kvOpenAt(
        handle: KvHandle,
        prefix: *const u8,
        len: u32,
        mode: KvMode,
    ) -> KvHandle {
        let src = KvBucket::from_handle(handle);
        KvBucket::new(src.chain_handle, src.db, src.key(prefix, len), mode).handle()
    }

    pub unsafe fn kvClose(handle: KvHandle) {
        let ptr = KvBucket::from_handle(handle) as *mut KvBucket;
        ptr.drop_in_place();
        std::alloc::dealloc(ptr as *mut u8, std::alloc::Layout::new::<KvBucket>());
    }

    pub unsafe fn kvGet(db: KvHandle, key: *const u8, key_len: u32) -> u32 {
        let bucket = KvBucket::from_handle(db);
        let full_key = bucket.key(key, key_len);
        tester_raw::kvGet(
            bucket.chain_handle,
            bucket.db,
            full_key.as_ptr(),
            full_key.len() as u32,
        )
    }

    pub unsafe fn getSequential(db: DbId, id: u64) -> u32 {
        return tester_raw::getSequential(get_selected_chain(), db, id);
    }

    pub unsafe fn getKey(dest: *mut u8, dest_size: u32) -> u32 {
        // copy the key into a temporary buffer to trim off the prefix
        let prefix_size = tester_raw::KEY_PREFIX_LEN.with(|l| l.get());
        let size = prefix_size + dest_size;
        let mut tmp = Vec::with_capacity(size as usize);

        let actual_size = tester_raw::getKey(tmp.as_mut_ptr(), size);
        let truncated_size = std::cmp::min(size, actual_size);
        tmp.set_len(truncated_size as usize);
        assert!(actual_size >= prefix_size);
        std::slice::from_raw_parts_mut(dest, (truncated_size - prefix_size) as usize)
            .copy_from_slice(&tmp[prefix_size as usize..truncated_size as usize]);
        actual_size - prefix_size
    }

    pub unsafe fn kvGreaterEqual(
        db: KvHandle,
        key: *const u8,
        key_len: u32,
        match_key_len: u32,
    ) -> u32 {
        let bucket = KvBucket::from_handle(db);
        let full_key = bucket.key(key, key_len);
        tester_raw::KEY_PREFIX_LEN.with(|l| l.set(bucket.prefix.len() as u32));
        tester_raw::kvGreaterEqual(
            bucket.chain_handle,
            bucket.db,
            full_key.as_ptr(),
            full_key.len() as u32,
            bucket.prefix.len() as u32 + match_key_len,
        )
    }

    pub unsafe fn kvLessThan(
        db: KvHandle,
        key: *const u8,
        key_len: u32,
        match_key_len: u32,
    ) -> u32 {
        let bucket = KvBucket::from_handle(db);
        let full_key = bucket.key(key, key_len);
        tester_raw::KEY_PREFIX_LEN.with(|l| l.set(bucket.prefix.len() as u32));
        tester_raw::kvLessThan(
            bucket.chain_handle,
            bucket.db,
            full_key.as_ptr(),
            full_key.len() as u32,
            bucket.prefix.len() as u32 + match_key_len,
        )
    }

    pub unsafe fn kvMax(db: KvHandle, key: *const u8, key_len: u32) -> u32 {
        let bucket = KvBucket::from_handle(db);
        let full_key = bucket.key(key, key_len);
        tester_raw::KEY_PREFIX_LEN.with(|l| l.set(bucket.prefix.len() as u32));
        tester_raw::kvMax(
            bucket.chain_handle,
            bucket.db,
            full_key.as_ptr(),
            full_key.len() as u32,
        )
    }

    pub unsafe fn kvPut(
        db: KvHandle,
        key: *const u8,
        key_len: u32,
        value: *const u8,
        value_len: u32,
    ) {
        let bucket = KvBucket::from_handle(db);
        let full_key = bucket.key(key, key_len);
        tester_raw::kvPut(
            bucket.chain_handle,
            bucket.db,
            full_key.as_ptr(),
            full_key.len() as u32,
            value,
            value_len,
        )
    }

    pub unsafe fn kvRemove(db: KvHandle, key: *const u8, key_len: u32) {
        let bucket = KvBucket::from_handle(db);
        let full_key = bucket.key(key, key_len);
        tester_raw::kvRemove(
            bucket.chain_handle,
            bucket.db,
            full_key.as_ptr(),
            full_key.len() as u32,
        )
    }
}
