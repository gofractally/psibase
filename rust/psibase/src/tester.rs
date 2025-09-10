//! Wrapped native functions for tests to use
//!
//! Native functions give tests the ability to execute shell commands,
//! read files, create block chains, push transactions to those chains,
//! and control block production on those chains.
//!
//! These functions and types wrap the [Raw Native Functions](crate::tester_raw).

#![cfg_attr(not(target_family = "wasm"), allow(unused_imports, dead_code))]

use crate::{
    check, create_boot_transactions, get_result_bytes, kv_get, services, status_key, tester_raw,
    AccountNumber, Action, BlockTime, Caller, Checksum256, CodeByHashRow, CodeRow, DbId,
    DirectoryRegistry, Error, HttpBody, HttpReply, HttpRequest, InnerTraceEnum, PackageRegistry,
    Seconds, SignedTransaction, StatusRow, TimePointSec, TimePointUSec, ToKey, Transaction,
    TransactionTrace,
};
use anyhow::anyhow;
use fracpack::{Pack, Unpack};
use futures::executor::block_on;
use psibase_macros::account_raw;
use serde::de::DeserializeOwned;
use sha2::{Digest, Sha256};
use std::cell::{Cell, RefCell};
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
}

impl Default for Chain {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for Chain {
    fn drop(&mut self) {
        unsafe { tester_raw::destroyChain(self.chain_handle) }
        tester_raw::tester_clear_chain_for_db(self.chain_handle)
    }
}

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

    /// Boot the tester chain with default services being deployed
    pub fn boot(&self) -> Result<(), Error> {
        let default_services: Vec<String> = vec!["TestDefault".to_string()];
        self.boot_with(&Self::default_registry(), &default_services[..])
    }

    pub fn default_registry() -> DirectoryRegistry {
        let psibase_data_dir = std::env::var("PSIBASE_DATADIR")
            .expect("Cannot find package directory: PSIBASE_DATADIR not defined");
        let packages_dir = Path::new(&psibase_data_dir).join("packages");
        DirectoryRegistry::new(packages_dir)
    }

    pub fn boot_with<R: PackageRegistry>(&self, reg: &R, services: &[String]) -> Result<(), Error> {
        let mut services = block_on(reg.resolve(services))?;

        const COMPRESSION_LEVEL: u32 = 4;
        let (boot_tx, subsequent_tx) = create_boot_transactions(
            &None,
            &None,
            AccountNumber::new(account_raw!("prod")),
            false,
            TimePointSec { seconds: 10 },
            &mut services[..],
            COMPRESSION_LEVEL,
        )
        .unwrap();

        for trx in boot_tx {
            self.push(&trx).ok()?;
        }

        for (_, group, _) in subsequent_tx {
            for trx in group {
                self.push(&trx).ok()?;
            }
        }

        self.start_block();

        Ok(())
    }

    /// Create a new chain and make it active for database native functions.
    ///
    /// The arguments are the file sizes in bytes for the database's
    /// various files.
    pub fn create(hot_bytes: u64, warm_bytes: u64, cool_bytes: u64, cold_bytes: u64) -> Chain {
        println!("TESTER CREATE");
        let chain_handle =
            unsafe { tester_raw::createChain(hot_bytes, warm_bytes, cool_bytes, cold_bytes) };
        if chain_handle == 0 {
            tester_raw::tester_select_chain_for_db(chain_handle)
        }
        let mut result = Chain {
            chain_handle,
            status: None.into(),
            producing: false.into(),
            is_auto_block_start: true,
        };
        result.load_local_services();
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
        let packages = block_on(registry.resolve(&package_names)).unwrap();
        let mut requests = Vec::new();
        unsafe {
            tester_raw::checkoutSubjective(self.chain_handle);
        }
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
            }

            let root_host = "psibase";

            for (account, path, file) in package.data() {
                let Some(mime_type) = mime_guess::from_path(&path).first() else {
                    panic!("Cannot determine Mime-Type for {}", path)
                };
                requests.push(HttpRequest {
                    host: account.to_string() + "." + root_host,
                    rootHost: root_host.to_string(),
                    method: "PUT".to_string(),
                    target: path,
                    contentType: mime_type.to_string(),
                    headers: Vec::new(),
                    body: file.into(),
                });
            }
        }
        check(
            unsafe { tester_raw::commitSubjective(self.chain_handle) },
            "Failed to commit changes",
        );
        for request in requests {
            let reply = self.http(&request).unwrap();
            if reply.status != 200 {
                panic!("PUT failed: {}", reply.text().unwrap());
            }
        }
    }

    /// Start a new block
    ///
    /// Starts a new block at `time`. If `time.seconds` is 0,
    /// then starts a new block 1 second after the most recent.
    pub fn start_block_at(&self, time: BlockTime) {
        let status = &mut *self.status.borrow_mut();

        // Guarantee that there is a recent block for fillTapos to use.
        if let Some(status) = status {
            if status.current.time + Seconds::new(1) < time {
                unsafe {
                    tester_raw::startBlock(self.chain_handle, (time - Seconds::new(1)).microseconds)
                }
            }
        }
        unsafe { tester_raw::startBlock(self.chain_handle, time.microseconds) }
        *status = kv_get::<StatusRow, _>(StatusRow::DB, &status_key()).unwrap();
        self.producing.replace(true);
    }

    /// Start a new block
    ///
    /// Starts a new block 1 second after the most recent.
    pub fn start_block(&self) {
        self.start_block_at(TimePointUSec { microseconds: 0 })
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
        self.http(&HttpRequest {
            host: format!("{}.psibase.io", account),
            rootHost: "psibase.io".into(),
            method: "GET".into(),
            target: target.into(),
            contentType: "".into(),
            body: <Vec<u8>>::new().into(),
            headers: vec![],
        })
    }

    pub fn post(
        &self,
        account: AccountNumber,
        target: &str,
        data: HttpBody,
    ) -> Result<HttpReply, anyhow::Error> {
        self.http(&HttpRequest {
            host: format!("{}.psibase.io", account),
            rootHost: "psibase.io".into(),
            method: "POST".into(),
            target: target.into(),
            contentType: data.contentType,
            body: data.body,
            headers: vec![],
        })
    }

    pub fn graphql<T: DeserializeOwned>(
        &self,
        account: AccountNumber,
        query: &str,
    ) -> Result<T, anyhow::Error> {
        self.post(account, "/graphql", HttpBody::graphql(query))?
            .json()
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
