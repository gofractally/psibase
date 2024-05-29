//! Wrapped native functions for tests to use
//!
//! Native functions give tests the ability to execute shell commands,
//! read files, create block chains, push transactions to those chains,
//! and control block production on those chains.
//!
//! These functions and types wrap the [Raw Native Functions](crate::tester_raw).

use crate::{
    create_boot_transactions, get_result_bytes, kv_get, services, status_key, tester_raw,
    AccountNumber, Action, Caller, DirectoryRegistry, Error, InnerTraceEnum, JointRegistry,
    PackageRegistry, Reflect, SignedTransaction, StatusRow, TimePointSec, Transaction,
    TransactionTrace,
};
use anyhow::anyhow;
use fracpack::{Pack, Unpack};
use futures::executor::block_on;
use psibase_macros::account_raw;
use std::cell::{Cell, RefCell};
use std::path::Path;
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
}

impl Default for Chain {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for Chain {
    fn drop(&mut self) {
        unsafe { tester_raw::testerDestroyChain(self.chain_handle) }
    }
}

impl Chain {
    /// Create a new chain and make it active for database native functions.
    ///
    /// Shortcut for `Tester::create(1 << 27, 1 << 27, 1 << 27, 1 << 27)`
    pub fn new() -> Chain {
        Self::create(1 << 27, 1 << 27, 1 << 27, 1 << 27)
    }

    /// Boot the tester chain with default services being deployed
    pub fn boot(&self) -> Result<(), Error> {
        let default_services: Vec<String> = vec!["Default".to_string()];

        let psibase_data_dir = std::env::var("PSIBASE_DATADIR")
            .expect("Cannot find package directory: PSIBASE_DATADIR not defined");
        let packages_dir = Path::new(&psibase_data_dir).join("packages");

        let mut result = JointRegistry::new();
        result.push(DirectoryRegistry::new(packages_dir))?;
        let mut services = block_on(result.resolve(&default_services[..]))?;

        let (boot_tx, subsequent_tx) = create_boot_transactions(
            &None,
            AccountNumber::new(account_raw!("prod")),
            false,
            TimePointSec { seconds: 10 },
            &mut services[..],
        )
        .unwrap();

        for trx in boot_tx {
            self.push(&trx).ok()?;
        }

        for trx in subsequent_tx {
            self.push(&trx).ok()?;
        }

        Ok(())
    }

    /// Create a new chain and make it active for database native functions.
    ///
    /// The arguments are the file sizes in bytes for the database's
    /// various files.
    pub fn create(hot_bytes: u64, warm_bytes: u64, cool_bytes: u64, cold_bytes: u64) -> Chain {
        unsafe {
            Chain {
                chain_handle: tester_raw::testerCreateChain(
                    hot_bytes, warm_bytes, cool_bytes, cold_bytes,
                ),
                status: None.into(),
                producing: false.into(),
            }
        }
    }

    /// Start a new block
    ///
    /// Starts a new block at `time`. If `time.seconds` is 0,
    /// then starts a new block 1 second after the most recent.
    ///
    /// TODO: Support sub-second block times
    pub fn start_block_at(&self, time: TimePointSec) {
        let status = &mut *self.status.borrow_mut();

        // Guarantee that there is a recent block for fillTapos to use.
        if let Some(status) = status {
            if status.current.time.seconds + 1 < time.seconds {
                unsafe { tester_raw::testerStartBlock(self.chain_handle, time.seconds - 1) }
            }
        }
        unsafe { tester_raw::testerStartBlock(self.chain_handle, time.seconds) }
        *status = kv_get::<StatusRow, _>(StatusRow::DB, &status_key()).unwrap();
        self.producing.replace(true);
    }

    /// Start a new block
    ///
    /// Starts a new block 1 second after the most recent.
    pub fn start_block(&self) {
        self.start_block_at(TimePointSec { seconds: 0 })
    }

    /// Finish a block
    ///
    /// This does nothing if a block isn't currently being produced.
    pub fn finish_block(&self) {
        unsafe { tester_raw::testerFinishBlock(self.chain_handle) }
        self.producing.replace(false);
    }

    /// Fill tapos fields
    ///
    /// `expire_seconds` is relative to the most-recent block.
    pub fn fill_tapos(&self, trx: &mut Transaction, expire_seconds: u32) {
        trx.tapos.expiration.seconds = expire_seconds;
        trx.tapos.refBlockIndex = 0;
        trx.tapos.refBlockSuffix = 0;
        if let Some(status) = &*self.status.borrow() {
            trx.tapos.expiration.seconds = status.current.time.seconds + expire_seconds;
            if let Some(head) = &status.head {
                let mut suffix = [0; 4];
                suffix.copy_from_slice(&head.blockId[head.blockId.len() - 4..]);
                trx.tapos.refBlockIndex = (head.header.blockNum & 0x7f) as u8;
                trx.tapos.refBlockSuffix = u32::from_le_bytes(suffix);
            }
        }
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
            tester_raw::testerPushTransaction(
                self.chain_handle,
                transaction.as_ptr(),
                transaction.len(),
            )
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
        let size = tester_raw::testerGetChainPath(self.chain_handle, null_mut(), 0);
        let mut bytes = Vec::with_capacity(size);
        tester_raw::testerGetChainPath(self.chain_handle, bytes.as_mut_ptr(), size);
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
        unsafe { tester_raw::testerSelectChainForDb(self.chain_handle) }
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
                        println!(
                            ">>> ChainResult::get - Inner action trace: {} (raw_retval={})",
                            at.action.method, at.raw_retval
                        );
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
                println!(">>> ChainResult::get - Unpacking ret: `{}`", ret);
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

#[derive(Clone, Debug, Reflect)]
#[reflect(psibase_mod = "crate")]
pub struct ChainPusher<'a> {
    #[reflect(skip)]
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
        ret
    }
}
