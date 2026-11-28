#include <atomic>
#include <boost/filesystem/operations.hpp>
#include <psibase/ActionContext.hpp>
#include <psibase/FileStore.hpp>
#include <psibase/LogSocket.hpp>
#include <psibase/NativeAotCache.hpp>
#include <psibase/NativeFunctions.hpp>
#include <psibase/Prover.hpp>
#include <psibase/PsizamPolicy.hpp>
#include <psibase/Socket.hpp>
#include <psibase/VmEngine.hpp>
#include <psibase/WasmtimeHost.hpp>
#include <psibase/Watchdog.hpp>
#include <psibase/api.hpp>
#include <psibase/crypto.hpp>
#include <psibase/finally.hpp>
#include <psibase/log.hpp>
#include <psibase/prefix.hpp>
#include <psibase/serviceEntry.hpp>
#include <psibase/version.hpp>
#include <psio/json.hpp>
#include <psio/json_value.hpp>
#include <psio/pssz_view.hpp>
#include <psizam/utils.hpp>
#include "VmConsensusReplay.hpp"

#include <cxxabi.h>

#include <stdio.h>
#include <time.h>
#ifdef __APPLE__
#include <crt_externs.h>
#endif

static char** host_environment()
{
#ifdef __APPLE__
   return *_NSGetEnviron();
#else
   return ::environ;
#endif
}
#include <bitset>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <optional>
#include <random>
#include <thread>

#include <sys/stat.h>

using namespace std::literals;

using std::span;
namespace wt = psizam::wasmtime;
using psibase::WatchdogManager;

struct callbacks;

using cl_flags_t = std::bitset<16>;
enum cl_flags
{
   timing
};

void backtrace();

// ── The engine of the test module ───────────────────────────────────────────
//
// The test module (the wasm psitest is given) runs on wasmtime, through the
// same psizam backend the node runs services on (psibase/WasmtimeHost.hpp has
// what the two share). It is the only engine psitest has for it: a module
// wasmtime does not take is an error, never a reason to try another engine.
//
// A test module is a program of the developer's, not chain code, so none of
// the chain's policy for services applies to it, and this is where that is
// stated:
//
//  - No admission: psizam's validator and the chain's VMOptions limits
//    (function count and size, locals, nesting, table and memory sections,
//    imports) are not applied. wasmtime validates the module under the
//    proposal set below, and that is all.
//  - No stack byte budget: the module is compiled without psizam's stack
//    metering. Its recursion is bounded by a native stack allowance
//    (testModuleStackBytes), not by max_stack_bytes.
//  - No memory or table limit beyond the format's (4 GiB, 2^32-1 elements).
//  - No CPU limit and no watchdog. --timeout is the only bound on run time.
//  - Its imports are the tester's (register_callbacks), not the services'.
//  - No instance pool: there is one instance per process.
//
// What it does share with services: the wasmtime build, the proposal set
// (vm_wasmtime::wasmFeatures), deterministic floats, and the store of
// compiled modules (PSIBASE_NATIVE_AOT_CACHE, or the user's cache directory),
// under keys of its own.
namespace test_module
{
   inline constexpr std::string_view engineName = "wasmtime";

   // Test modules contain no relaxed-SIMD madd, the one operation the two
   // float profiles differ in. Strict is what the tester's psizam engine ran
   // them under, and what version 0 services run under.
   inline constexpr auto floatProfile = wt::float_profile::strict;

   // Native stack the test module's own wasm frames may use. Beyond it the
   // module traps (call stack exhausted).
   inline constexpr std::uint64_t testModuleStackBytes = std::uint64_t(64) << 20;
   // The whole native stack the module is entered on. Services the module
   // runs are entered from its host functions, so they run on this stack
   // too, below the module's frames, and their engine counts on a stack of
   // serviceNativeStackBytes to itself.
   inline constexpr std::uint64_t nativeStackBytes =
       testModuleStackBytes + psibase::vm_wasmtime::serviceNativeStackBytes +
       (std::uint64_t(64) << 20);

   inline constexpr std::uint32_t backtraceFrames = 512;

   // `debugger`: also give gdb/lldb the module's code and source lines
   // (--debug-module). Slower to compile, and compiled separately.
   inline wt::engine_options engineOptions(bool debugger)
   {
      wt::engine_options o;
      o.features       = psibase::vm_wasmtime::wasmFeatures;
      o.fp             = floatProfile;
      o.max_wasm_stack = testModuleStackBytes;
      o.native_stack   = nativeStackBytes;
      // What --timeout stops the module with.
      o.epoch_interruption = true;
      // testerAbort, abortMessage and a trap print where the module was.
      o.backtrace            = true;
      o.backtrace_details    = true;
      o.backtrace_max_frames = backtraceFrames;
      o.debug_info           = debugger;
      return o;
   }

   inline constexpr wt::instance_limits instanceLimits{
       .max_memory_bytes   = std::uint64_t(65536) * 65536,
       .max_table_elements = 0xffff'ffffu,
   };

   // Everything that determines the compiled code. The stack sizes are not
   // part of it: they are limits the engine applies at run time.
   inline psibase::NativeAotCache::Key artifactKey(std::span<const std::uint8_t> wasm,
                                                   const wt::engine_options&     options)
   {
      auto digest = psibase::sha256(std::tuple{
          std::string("psitest-wasmtime-test-module-v1"),
          psibase::sha256(reinterpret_cast<const char*>(wasm.data()), wasm.size()),
          options.features, std::uint32_t(options.fp), options.epoch_interruption,
          options.backtrace_details, options.debug_info, std::string(wt::build_identity())});
      psibase::NativeAotCache::Key key;
      std::copy(digest.begin(), digest.end(), key.begin());
      return key;
   }

   // The module for `wasm`: from the store of compiled modules, which returns
   // only what it has verified (NativeAotCache.hpp), or compiled now and
   // stored. Throws wasmtime's error if it does not compile.
   template <typename Host>
   wt::module obtain(const wt::runtime<Host>&      runtime,
                     std::span<const std::uint8_t> wasm,
                     const wt::engine_options&     options)
   {
      auto       artifacts = psibase::nativeAotCacheFromEnvironment();
      const auto key       = artifactKey(wasm, options);
      const auto start     = std::chrono::steady_clock::now();
      auto       elapsed   = [&]
      {
         return std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::steady_clock::now() - start)
             .count();
      };
      if (artifacts)
         if (auto stored = artifacts->load(key))
            try
            {
               auto module = runtime.load(std::span(
                   reinterpret_cast<const std::uint8_t*>(stored->data()), stored->size()));
               PSIBASE_LOG(psibase::loggers::generic::get(), debug)
                   << "Test module loaded from the compiled-module cache in " << elapsed()
                   << " ms";
               return module;
            }
            catch (const std::exception&)
            {
               // Intact, but this engine will not take it: compile again.
            }
      auto        module = runtime.compile(wasm);
      std::size_t stored = 0;
      if (artifacts)
      {
         auto artifact = module.serialize();
         stored        = artifact.size();
         artifacts->store(
             key, std::span(reinterpret_cast<const char*>(artifact.data()), artifact.size()));
      }
      PSIBASE_LOG(psibase::loggers::generic::get(), debug)
          << "Test module compiled by " << engineName << " in " << elapsed()
          << " ms: " << wasm.size() << " bytes of wasm, " << stored << " bytes of native code";
      return module;
   }
}  // namespace test_module

inline constexpr int      block_interval_ms   = 500;
inline constexpr int      block_interval_us   = block_interval_ms * 1000;
inline constexpr uint32_t billed_cpu_time_use = 2000;

inline constexpr int32_t polyfill_root_dir_fd = 3;

/** WASI Types */
using wasi_errno_t                                = uint16_t;
inline constexpr wasi_errno_t wasi_errno_success  = 0;
inline constexpr wasi_errno_t wasi_errno_again    = 6;
inline constexpr wasi_errno_t wasi_errno_badf     = 8;
inline constexpr wasi_errno_t wasi_errno_fault    = 21;
inline constexpr wasi_errno_t wasi_errno_inval    = 28;
inline constexpr wasi_errno_t wasi_errno_io       = 29;
inline constexpr wasi_errno_t wasi_errno_noent    = 44;
inline constexpr wasi_errno_t wasi_errno_overflow = 61;

inline constexpr uint8_t wasi_filetype_unknown          = 0;
inline constexpr uint8_t wasi_filetype_block_device     = 1;
inline constexpr uint8_t wasi_filetype_character_device = 2;
inline constexpr uint8_t wasi_filetype_directory        = 3;
inline constexpr uint8_t wasi_filetype_regular_file     = 4;
inline constexpr uint8_t wasi_filetype_symbolic_link    = 7;

inline constexpr uint64_t wasi_rights_fd_read  = 2;
inline constexpr uint64_t wasi_rights_fd_write = 64;

inline constexpr uint16_t wasi_oflags_creat     = 1;
inline constexpr uint16_t wasi_oflags_directory = 2;
inline constexpr uint16_t wasi_oflags_excl      = 4;
inline constexpr uint16_t wasi_oflags_trunc     = 8;

inline constexpr uint16_t wasi_fdflags_append   = 1;
inline constexpr uint16_t wasi_fdflags_dsync    = 2;
inline constexpr uint16_t wasi_fdflags_nonblock = 4;
inline constexpr uint16_t wasi_fdflags_rsync    = 8;
inline constexpr uint16_t wasi_fdflags_sync     = 1;

inline constexpr uint16_t wasi_preopentype_dir = 0;

inline constexpr std::uint32_t wasi_lookupflags_symlink_follow = 1;

using wasi_size_t        = uint32_t;
using wasi_ptr_t         = uint32_t;
using wasi_fd_t          = uint32_t;
using wasi_dircookie_t   = uint64_t;
using wasi_whence_t      = uint8_t;
using wasi_filedelta_t   = int64_t;
using wasi_oflags_t      = uint32_t;  // uint16_t;
using wasi_filesize_t    = uint64_t;
using wasi_exitcode_t    = uint32_t;
using wasi_lookupflags_t = uint32_t;

using wasi_rights_t   = uint64_t;
using wasi_fdflags_t  = uint16_t;
using wasi_filetype_t = uint8_t;
struct wasi_fdstat_t
{
   wasi_filetype_t fs_filetype;
   wasi_fdflags_t  fs_flags;
   wasi_rights_t   fs_rights_base;
   wasi_rights_t   fs_rights_inheriting;
};

using wasi_device_t    = uint64_t;
using wasi_inode_t     = uint64_t;
using wasi_filetype_t  = uint8_t;
using wasi_linkcount_t = uint64_t;
using wasi_filesize_t  = uint64_t;
using wasi_timestamp_t = uint64_t;

using wasi_preopentype_t = uint8_t;
struct wasi_prestat_dir_t
{
   wasi_size_t pr_name_len;
};
union wasi_prestat_u_t
{
   wasi_prestat_dir_t dir;
};
struct wasi_prestat_t
{
   wasi_preopentype_t tag;
   wasi_prestat_u_t   u;
};

struct wasi_iovec_t
{
   wasi_ptr_t  buf;
   wasi_size_t buf_len;
};
// End of WASI Types

struct assert_exception : std::exception
{
   std::string msg;

   assert_exception(std::string&& msg) : msg(std::move(msg)) {}

   const char* what() const noexcept override { return msg.c_str(); }
};

struct exit_exception : std::exception
{
   explicit exit_exception(std::uint32_t code) : code(code) {}
   virtual const char* what() const noexcept override { return "exit"; }
   std::int32_t        code;
};

struct NullProver : psibase::Prover
{
   std::vector<char> prove(std::span<const char>, const psibase::Claim&) const { return {}; }
   bool              remove(const psibase::Claim&) { return false; }
   void              get(std::vector<psibase::Claim>&) const {}
   void              get(std::vector<psibase::ClaimKey>&) const {}
};

struct file;
struct HttpSocket;
struct test_chain;

struct WasmMemoryCache
{
   std::vector<std::vector<psibase::ExecutionMemory>> memories;
   void                                               init(psibase::SystemContext& ctx)
   {
      if (!memories.empty())
      {
         ctx.executionMemories = std::move(memories.back());
         memories.pop_back();
      }
   }
   void cleanup(psibase::SystemContext& ctx)
   {
      if (!ctx.executionMemories.empty())
         memories.push_back(std::move(ctx.executionMemories));
   }
};

struct state
{
   const char*                              wasm;
   // Set once the test module is instantiated.
   wt::instance<callbacks>*                 instance = nullptr;
   std::vector<std::string>                 args;
   cl_flags_t                               additional_args;
   std::vector<file>                        files;
   std::vector<std::shared_ptr<HttpSocket>> sockets;
   psibase::WasmCache                       shared_wasm_cache{128};
   WasmMemoryCache                          shared_memory_cache;
   std::vector<std::unique_ptr<test_chain>> chains;
   std::shared_ptr<WatchdogManager>         watchdogManager = std::make_shared<WatchdogManager>();
   std::vector<char>                        result_key;
   std::vector<char>                        result_value;
};

template <typename T>
using wasm_ptr = psizam::detail::argument_proxy<T*>;

struct test_chain;

struct test_chain_ref
{
   test_chain* chain = {};

   test_chain_ref() = default;
   test_chain_ref(test_chain&);
   test_chain_ref(const test_chain_ref&);
   ~test_chain_ref();

   test_chain_ref& operator=(const test_chain_ref&);
};

struct NullSocket : psibase::Socket
{
   void                send(psibase::Writer&, std::span<const char> data, std::uint32_t) {}
   psibase::SocketInfo info() const { return psibase::ProducerMulticastSocketInfo{}; }
};

struct test_chain
{
   psibase::vm_consensus_replay::Capture vmReplayCapture;
   ::state&                                 state;
   std::set<test_chain_ref*>                refs;
   psibase::SharedDatabase                  db;
   psibase::WriterPtr                       writer;
   std::unique_ptr<psibase::SystemContext>  sys;
   std::shared_ptr<const psibase::Revision> revisionAtBlockStart;
   std::shared_ptr<const psibase::Revision> head;
   std::unique_ptr<psibase::BlockContext>   blockContext;
   // altBlockContext is created on demand to handle db reads between blocks
   std::unique_ptr<psibase::BlockContext>       altBlockContext;
   std::unique_ptr<psibase::TransactionTrace>   nativeFunctionsTrace;
   std::unique_ptr<psibase::TransactionContext> nativeFunctionsTransactionContext;
   std::unique_ptr<psibase::ActionContext>      nativeFunctionsActionContext;
   std::unique_ptr<psibase::NativeFunctions>    nativeFunctions;
   std::string                                  name = "testchain";
   psibase::loggers::common_logger              logger;

   std::chrono::system_clock::time_point getTimestamp()
   {
      if (blockContext)
      {
         return blockContext->current.header.time;
      }
      else
      {
         return std::chrono::system_clock::now();
      }
   }
   const std::string& getName() { return name; }

   test_chain(::state& state, psibase::SharedDatabase&& db) : state{state}, db{std::move(db)}
   {
      writer = this->db.createWriter();
      sys    = std::make_unique<psibase::SystemContext>(
          psibase::SystemContext{this->db,
                                 state.shared_wasm_cache,
                                 {},
                                 state.watchdogManager,
                                 std::make_shared<psibase::Sockets>(this->db)});
      // Plain files of node-local services live beside the chain's data.
      // Chains of one test process can share a database directory (one is
      // cloned from another), and files are not part of a database, so each
      // chain gets a directory of its own.
      static std::atomic<unsigned> nextFileStore{0};
      sys->files = std::make_shared<psibase::FileStore>(
          this->db.directory() / "files" / std::to_string(nextFileStore++));
      state.shared_memory_cache.init(*sys);
      head = this->db.getHead();
   }

   test_chain(::state&                         state,
              const std::filesystem::path&     path,
              const psibase::storage::database_config& config,
              psibase::storage::open_mode              mode)
       : test_chain{state, {path, config, mode}}
   {
      if (mode != psibase::storage::open_mode::read_only)
      {
         sys->sockets->set(*writer, psibase::SocketRow::producer_multicast,
                           std::make_shared<NullSocket>());
         sys->sockets->set(*writer, psibase::SocketRow::log, psibase::makeLogSocket());
      }
   }

   explicit test_chain(const test_chain& other) : test_chain{other.state, other.db.clone()}
   {
      sys->sockets->set(*writer, psibase::SocketRow::producer_multicast,
                        std::make_shared<NullSocket>());
      sys->sockets->set(*writer, psibase::SocketRow::log, psibase::makeLogSocket());
   }

   bool setFork(const psibase::Checksum256& id)
   {
      if (auto newHead = db.getRevision(*writer, id))
      {
         nativeFunctions.reset();
         nativeFunctionsActionContext.reset();
         nativeFunctionsTransactionContext.reset();
         blockContext.reset();
         altBlockContext.reset();
         revisionAtBlockStart.reset();
         head = std::move(newHead);
         return true;
      }
      else
      {
         return false;
      }
   }

   test_chain& operator=(const test_chain&) = delete;

   ~test_chain()
   {
      for (auto* ref : refs)
         ref->chain = nullptr;
      nativeFunctions.reset();
      nativeFunctionsActionContext.reset();
      nativeFunctionsTransactionContext.reset();
      blockContext.reset();
      altBlockContext.reset();
      revisionAtBlockStart.reset();
      state.shared_memory_cache.cleanup(*sys);
      sys.reset();
      writer = {};
      db     = {};
   }

   void startBlock(std::optional<psibase::BlockTime> time,
                   psibase::AccountNumber            producer,
                   psibase::TermNum                  term,
                   psibase::BlockNum                 commitNum)
   {
      // TODO: undo control
      finishBlock();
      revisionAtBlockStart = head;
      nativeFunctions.reset();
      nativeFunctionsActionContext.reset();
      nativeFunctionsTransactionContext.reset();
      altBlockContext.reset();

      vmReplayCapture.begin(db, head, name);
      blockContext =
          std::make_unique<psibase::BlockContext>(*sys, revisionAtBlockStart, writer, true);

      blockContext->start(time, producer, term, commitNum);
   }

   void start_if_needed()
   {
      if (!blockContext)
         psibase::abortMessage("Not building a block");
   }

   void finishBlock()
   {
      if (blockContext)
      {
         BOOST_LOG_SCOPED_THREAD_TAG("TimeStamp", getTimestamp());
         BOOST_LOG_SCOPED_THREAD_TAG("Host", getName());
         nativeFunctions.reset();
         nativeFunctionsActionContext.reset();
         nativeFunctionsTransactionContext.reset();
         auto [revision, blockId] = blockContext->writeRevision(NullProver{}, psibase::Claim{});
         vmReplayCapture.finish(db, revision, blockContext->current);
         head                     = revision;
         db.setHead(*writer, revision);
         db.removeRevisions(*writer, blockId);  // temp rule: head is now irreversible
         PSIBASE_LOG_CONTEXT_BLOCK(logger, blockContext->current.header, blockId);
         PSIBASE_LOG(logger, info) << "Produced block";
         blockContext.reset();
         revisionAtBlockStart.reset();
      }
   }

   psibase::BlockContext* readBlockContext()
   {
      if (blockContext)
         return blockContext.get();
      else
      {
         if (!altBlockContext)
            altBlockContext = std::make_unique<psibase::BlockContext>(*sys, head, writer, true);
         return altBlockContext.get();
      }
   }

   void writeRevision()
   {
      psibase::check(!blockContext, "may not call writeRevision while building a block");
      if (altBlockContext)
      {
         auto status = altBlockContext->db.kvGet<psibase::StatusRow>(psibase::StatusRow::db,
                                                                     psibase::statusKey());
         psibase::check(status.has_value(), "missing status record");
         auto revision = altBlockContext->session.writeRevision(status->head->blockId);
         head          = revision;
         db.setHead(*writer, revision);
      }
   }

   psibase::NativeFunctions& native()
   {
      static const psibase::SignedTransaction dummyTransaction;
      static const psibase::Action            dummyAction;
      if (!nativeFunctions)
      {
         auto* blockContext = readBlockContext();
         if (!blockContext)
            throw std::runtime_error("no block context to read database from");
         nativeFunctionsTrace = std::make_unique<psibase::TransactionTrace>();
         nativeFunctionsTrace->actionTraces.resize(1);
         nativeFunctionsTransactionContext = std::make_unique<psibase::TransactionContext>(
             *blockContext, dummyTransaction, *nativeFunctionsTrace, psibase::DbMode::rpc());
         nativeFunctionsActionContext = std::make_unique<psibase::ActionContext>(
             psibase::ActionContext{*nativeFunctionsTransactionContext, dummyAction,
                                    nativeFunctionsTrace->actionTraces[0]});
         nativeFunctions = std::make_unique<psibase::NativeFunctions>(
             psibase::NativeFunctions{blockContext->db,
                                      *nativeFunctionsTransactionContext,
                                      psibase::DbMode::rpc(),
                                      {},
                                      &*nativeFunctionsActionContext});
      }
      return *nativeFunctions;
   }

   psibase::Database& database() { return native().database; }
};  // test_chain

struct ScopedCheckoutSubjective
{
   ScopedCheckoutSubjective(psibase::DbId db) : db(db) {}
   ScopedCheckoutSubjective(test_chain& chain, psibase::DbId db) : impl(&chain.native()), db(db)
   {
      impl->checkoutSubjective();
   }
   ~ScopedCheckoutSubjective()
   {
      if (impl && !impl->commitSubjective())
         psibase::abortMessage("commitSubjective failure should not happen without concurrency");
   }
   psibase::NativeFunctions* impl = nullptr;
   psibase::DbId             db;
};

test_chain_ref::test_chain_ref(test_chain& chain)
{
   chain.refs.insert(this);
   this->chain = &chain;
}

test_chain_ref::test_chain_ref(const test_chain_ref& src)
{
   chain = src.chain;
   if (chain)
      chain->refs.insert(this);
}

test_chain_ref::~test_chain_ref()
{
   if (chain)
      chain->refs.erase(this);
}

test_chain_ref& test_chain_ref::operator=(const test_chain_ref& src)
{
   if (chain)
      chain->refs.erase(this);
   chain = nullptr;
   if (src.chain)
      src.chain->refs.insert(this);
   chain = src.chain;
   return *this;
}

struct file
{
   FILE* f    = nullptr;
   bool  owns = false;

   file(FILE* f = nullptr, bool owns = true) : f(f), owns(owns) {}

   file(const file&) = delete;
   file(file&& src) { *this = std::move(src); }

   ~file() { close(); }

   file& operator=(const file&) = delete;

   file& operator=(file&& src)
   {
      close();
      this->f    = src.f;
      this->owns = src.owns;
      src.f      = nullptr;
      src.owns   = false;
      return *this;
   }

   void close()
   {
      if (owns && f)
         fclose(f);
      f    = nullptr;
      owns = false;
   }
};

struct wasi_filestat_t
{
   static wasi_filestat_t from_stat(struct stat& stat)
   {
      wasi_filestat_t result;
      auto to_nsec = [](const timespec& t) { return t.tv_sec * 1000000000ull + t.tv_nsec; };
      result.dev   = stat.st_dev;
      result.ino   = stat.st_ino;
      if (S_ISREG(stat.st_mode))
         result.filetype = wasi_filetype_regular_file;
      else if (S_ISDIR(stat.st_mode))
         result.filetype = wasi_filetype_directory;
      else if (S_ISCHR(stat.st_mode))
         result.filetype = wasi_filetype_character_device;
      else if (S_ISBLK(stat.st_mode))
         result.filetype = wasi_filetype_block_device;
      else if (S_ISLNK(stat.st_mode))
         result.filetype = wasi_filetype_symbolic_link;
      else
         result.filetype = wasi_filetype_unknown;
      result.nlink = stat.st_nlink;
      result.size  = stat.st_size;
#ifdef __APPLE__
      result.atim = to_nsec(stat.st_atimespec);
      result.mtim = to_nsec(stat.st_mtimespec);
      result.ctim = to_nsec(stat.st_ctimespec);
#else   // not __APPLE__
      result.atim = to_nsec(stat.st_atim);
      result.mtim = to_nsec(stat.st_mtim);
      result.ctim = to_nsec(stat.st_ctim);
#endif  // apple
      return result;
   }
   wasi_device_t    dev;
   wasi_inode_t     ino;
   wasi_filetype_t  filetype;
   wasi_linkcount_t nlink;
   wasi_filesize_t  size;
   wasi_timestamp_t atim;
   wasi_timestamp_t mtim;
   wasi_timestamp_t ctim;
};
static_assert(sizeof(wasi_filestat_t) == 64);

struct QueryTimes
{
   std::chrono::microseconds             packTime;
   std::chrono::microseconds             serviceLoadTime;
   std::chrono::microseconds             databaseTime;
   std::chrono::microseconds             wasmExecTime;
   std::chrono::steady_clock::time_point startTime;
};

struct HttpSocket : psibase::AutoCloseSocket
{
   HttpSocket() {}
   void onClose(const std::optional<std::string>& message) noexcept override
   {
      if (!response.empty())
         return;
      psibase::HttpReply reply{.status      = psibase::HttpStatus::internalServerError,
                               .contentType = "text/html"};
      if (message)
      {
         reply.body = std::vector(message->begin(), message->end());
      }
      else
      {
         constexpr char defaultMessage[] = "service did not send a response";
         reply.body = std::vector(&defaultMessage[0], defaultMessage + sizeof(defaultMessage) - 1);
      }
      sendImpl(psio::to_pssz(reply));
   }
   void send(psibase::Writer&, std::span<const char> data, std::uint32_t flags) override
   {
      if (flags == psibase::sendFileFlag)
      {
         // A reply whose body is part of a file. A node sends it from the
         // file as the client takes it; a test gets it whole.
         if (!response.empty())
            return;
         auto file = psio::from_pssz<psibase::HttpFileReply>(data);
         auto body = files ? files->read(file.service, file.file, file.offset, file.length)
                           : std::nullopt;
         if (!body || body->size() != file.length)
         {
            file.reply = psibase::HttpReply{.status      = psibase::HttpStatus::notFound,
                                            .contentType = "text/plain"};
            body       = std::vector<char>{};
         }
         file.reply.body = std::move(*body);
         sendImpl(psio::to_pssz(file.reply));
         return;
      }
      if (flags != 0)
         psibase::abortMessage("Invalid flags for HttpSocket: " + std::to_string(flags));
      if (!response.empty())
         return;
      psibase::check(psio::validate_pssz<psibase::HttpReply>(data).ok(),
                     "HttpReply has invalid format");
      auto reply  = psio::pssz_view<psibase::HttpReply>{data};
      auto status = reply.status().unpack();
      auto code   = static_cast<std::uint16_t>(status);
      psibase::check(code >= 100 && code <= 599,
                     "HTTP response code not allowed: " + std::to_string(code));
      sendImpl(std::vector(data.begin(), data.end()));
   }
   void sendImpl(std::vector<char>&& reply)
   {
      response = std::move(reply);
      if (chain)
         logResponse();
   }
   psibase::SocketInfo info() const override
   {
      return psibase::HttpSocketInfo{psibase::LocalEndpoint{}};
   }
   void logResponse()
   {
      auto view    = psio::pssz_view<psibase::HttpReply>(response);
      auto endTime = std::chrono::steady_clock::now();

      BOOST_LOG_SCOPED_LOGGER_TAG(chain->logger, "Trace", std::move(trace));

      // TODO: consider bundling into a single attribute
      BOOST_LOG_SCOPED_LOGGER_TAG(chain->logger, "PackTime", queryTimes.packTime);
      BOOST_LOG_SCOPED_LOGGER_TAG(chain->logger, "ServiceLoadTime", queryTimes.serviceLoadTime);
      BOOST_LOG_SCOPED_LOGGER_TAG(chain->logger, "DatabaseTime", queryTimes.databaseTime);
      BOOST_LOG_SCOPED_LOGGER_TAG(chain->logger, "WasmExecTime", queryTimes.wasmExecTime);
      BOOST_LOG_SCOPED_LOGGER_TAG(
          chain->logger, "ResponseTime",
          std::chrono::duration_cast<std::chrono::microseconds>(endTime - queryTimes.startTime));

      auto status = static_cast<unsigned>(view.status().unpack());
      auto nBytes = static_cast<std::size_t>(view.body().size());
      BOOST_LOG_SCOPED_LOGGER_TAG(chain->logger, "ResponseStatus", status);
      BOOST_LOG_SCOPED_LOGGER_TAG(chain->logger, "ReponseBytes", nBytes);

      PSIBASE_LOG(chain->logger, info) << "Handled HTTP request";
   }
   std::vector<char>         response;
   std::shared_ptr<psibase::FileStore> files;
   psibase::TransactionTrace trace;
   QueryTimes                queryTimes;
   test_chain*               chain = nullptr;
};

struct callbacks
{
   ::state&          state;
   static callbacks* single;  // TODO: remove

   callbacks(::state& state) : state{state} { single = this; }
   ~callbacks() { single = nullptr; }

   static std::string demangle(const std::string& name)
   {
      int   status = 0;
      char* text   = abi::__cxa_demangle(name.c_str(), nullptr, nullptr, &status);
      std::string result = status == 0 && text ? text : name;
      std::free(text);
      return result;
   }

   // Innermost first: source file and line where the module's DWARF has
   // them, and the function's name from the DWARF-less name section.
   static void printFrames(const std::vector<wt::frame>& frames)
   {
      for (std::size_t i = 0; i < frames.size(); ++i)
      {
         const auto& frame = frames[i];
         if (!frame.file.empty())
            fprintf(stderr, "%s:%u", frame.file.c_str(), frame.line);
         else if (frame.module_offset)
            fprintf(stderr, "<wasm offset 0x%08llx>",
                    static_cast<unsigned long long>(*frame.module_offset));
         else
            fprintf(stderr, "<wasm function %u>", frame.function_index);
         if (!frame.function_name.empty())
            fprintf(stderr, ": %s", demangle(frame.function_name).c_str());
         // Runaway recursion is the same frame over and over.
         std::size_t same = 0;
         while (i + 1 < frames.size() && frames[i + 1].function_index == frame.function_index &&
                frames[i + 1].module_offset == frame.module_offset)
            ++i, ++same;
         if (same)
            fprintf(stderr, " (and %zu more of the same)", same);
         fprintf(stderr, "\n");
      }
      if (frames.size() == test_module::backtraceFrames)
         fprintf(stderr, "(outer frames not shown)\n");
   }

   void backtrace()
   {
      fprintf(stderr, "Generating backtrace...\n");
      if (state.instance)
         printFrames(state.instance->backtrace());
   }

   // The test module's linear memory.
   std::span<char> memory()
   {
      if (!state.instance)
         throw std::runtime_error("the test module has no memory yet");
      return state.instance->memory();
   }

   // `size` bytes of it at `ptr`.
   char* memoryAt(std::uint32_t ptr, std::uint64_t size)
   {
      auto all = memory();
      if (ptr > all.size() || size > all.size() - ptr)
         throw wt::host_memory_error("host pointer is outside linear memory");
      return all.data() + ptr;
   }

   // WASI passes an array of (pointer, length): read without assuming the
   // guest aligned it.
   wasi_iovec_t iovec(std::uint32_t iovs, std::uint32_t index)
   {
      const auto at = iovs + std::uint64_t(index) * sizeof(wasi_iovec_t);
      if (at > 0xffff'ffffu)
         throw wt::host_memory_error("host pointer is outside linear memory");
      wasi_iovec_t result;
      std::memcpy(&result, memoryAt(static_cast<std::uint32_t>(at), sizeof(result)),
                  sizeof(result));
      return result;
   }

   std::string span_str(span<const char> str) { return {str.data(), str.size()}; }

   void testerAbort()
   {
      backtrace();
      throw std::runtime_error("called testerAbort");
   }

   void wasi_proc_exit(int32_t code) { throw exit_exception(code); }

   int32_t wasi_sched_yield() { return 0; }

   uint32_t wasi_random_get(span<uint8_t> buf)
   {
      std::random_device rng;
      std::ranges::generate(buf, [&] { return rng(); });
      return 0;
   }

   void abortMessage(span<const char> msg)
   {
      backtrace();
      throw ::assert_exception(span_str(msg));
   }

   void writeConsole(span<const char> str) { std::cout.write(str.data(), str.size()); }

   int32_t wasi_args_sizes_get(wasm_ptr<wasi_size_t> argc, wasm_ptr<wasi_size_t> argv_buf_size)
   {
      uint32_t size = 0;
      for (auto& a : state.args)
         size += a.size() + 1;
      *argc          = state.args.size();
      *argv_buf_size = size;
      return 0;
   };

   // uint8_t** argv, uint8_t* argv_buf
   int32_t wasi_args_get(uint32_t argv, uint32_t argv_buf)
   {
      auto        all = memory();
      std::size_t end = all.size();
      if (argv > end || argv_buf > end)
         return wasi_errno_fault;
      for (auto& a : state.args)
      {
         auto size = a.size() + 1;
         if (end - argv_buf < size || end - argv < 4)
            return wasi_errno_fault;
         std::memcpy(all.data() + argv, &argv_buf, 4);
         std::memcpy(all.data() + argv_buf, a.c_str(), size);
         argv += 4;
         argv_buf += size;
      }
      return 0;
   };

   int32_t wasi_environ_sizes_get(wasm_ptr<uint32_t> environc, wasm_ptr<uint32_t> bufsize)
   {
      std::size_t totalSize = 0;
      char**      environment = host_environment();
      char**      p           = environment;
      for (; *p; ++p)
      {
         auto size = std::strlen(*p) + 1;
         if (std::numeric_limits<std::size_t>::max() - size < totalSize)
            return wasi_errno_overflow;
         totalSize += size;
      }
      if (totalSize > 0xffffffffu || p - environment > 0xffffffffu)
         return wasi_errno_overflow;
      *environc = p - environment;
      *bufsize  = totalSize;
      return 0;
   }

   int32_t wasi_environ_get(uint32_t env, uint32_t buf)
   {
      auto        all = this->memory();
      std::size_t end = all.size();
      if (env > end || buf > end)
         return wasi_errno_fault;
      char* memory = all.data();

      for (char** p = host_environment(); *p; ++p)
      {
         auto size = std::strlen(*p) + 1;
         if (end - buf < size || end - env < 4)
            return wasi_errno_fault;
         std::memcpy(memory + buf, *p, size);
         std::memcpy(memory + env, &buf, 4);
         buf += size;
         env += 4;
      }
      return 0;
   }

   int32_t wasi_clock_time_get(uint32_t id, uint64_t precision, wasm_ptr<uint64_t> time)
   {
      std::chrono::nanoseconds result;
      if (id == 0)
      {  // CLOCK_REALTIME
         result = std::chrono::system_clock::now().time_since_epoch();
      }
      else if (id == 1)
      {  // CLOCK_MONOTONIC
         result = std::chrono::steady_clock::now().time_since_epoch();
      }
      else if (id == 2 || id == 3)
      {  // Standard WASI PROCESS_CPUTIME_ID and THREAD_CPUTIME_ID.
         // Host clock IDs differ between platforms; do not pass WASI IDs
         // directly to clock_gettime or substitute elapsed time for CPU time.
         timespec stamp;
         const auto clock = id == 2 ? CLOCK_PROCESS_CPUTIME_ID : CLOCK_THREAD_CPUTIME_ID;
         if (::clock_gettime(clock, &stamp) != 0)
            return wasi_errno_inval;
         constexpr uint64_t nanos_per_second = 1'000'000'000;
         if (stamp.tv_sec < 0 || stamp.tv_nsec < 0 ||
             static_cast<uint64_t>(stamp.tv_nsec) >= nanos_per_second)
            return wasi_errno_inval;
         const auto seconds = static_cast<uint64_t>(stamp.tv_sec);
         const auto nanos   = static_cast<uint64_t>(stamp.tv_nsec);
         if (seconds > (std::numeric_limits<uint64_t>::max() - nanos) / nanos_per_second)
            return wasi_errno_overflow;
         *time = seconds * nanos_per_second + nanos;
         return wasi_errno_success;
      }
      else
      {
         return wasi_errno_inval;
      }
      *time = result.count();
      return 0;
   }

   file* get_file(int32_t file_index)
   {
      if (file_index < 0 || static_cast<uint32_t>(file_index) >= state.files.size() ||
          !state.files[file_index].f)
         return nullptr;
      return &state.files[file_index];
   }

   uint32_t wasi_fd_fdstat_get(wasi_fd_t fd, wasm_ptr<wasi_fdstat_t> stat)
   {
      if (fd == STDIN_FILENO)
      {
         stat->fs_filetype          = wasi_filetype_character_device;
         stat->fs_flags             = 0;
         stat->fs_rights_base       = wasi_rights_fd_read;
         stat->fs_rights_inheriting = 0;
         return 0;
      }
      if (fd == STDOUT_FILENO || fd == STDERR_FILENO)
      {
         stat->fs_filetype          = wasi_filetype_character_device;
         stat->fs_flags             = wasi_fdflags_append;
         stat->fs_rights_base       = wasi_rights_fd_write;
         stat->fs_rights_inheriting = 0;
         return 0;
      }
      if (fd == polyfill_root_dir_fd)
      {
         stat->fs_filetype          = wasi_filetype_directory;
         stat->fs_flags             = 0;
         stat->fs_rights_base       = 0;
         stat->fs_rights_inheriting = wasi_rights_fd_read | wasi_rights_fd_write;
         return 0;
      }
      if (get_file(fd))
      {
         stat->fs_filetype          = wasi_filetype_regular_file;
         stat->fs_flags             = 0;
         stat->fs_rights_base       = wasi_rights_fd_read | wasi_rights_fd_write;
         stat->fs_rights_inheriting = 0;
         return 0;
      }
      return wasi_errno_badf;
   }

   // TODO: flags should be uint16_t but there's a EOSVM compilation issue?
   uint32_t wasi_fd_fdstat_set_flags(wasi_fd_t fd, uint32_t flags)
   {
      // TODO: Implement
      return 0;
   }

   uint32_t wasi_fd_readdir(wasi_fd_t             fd,
                            span<uint8_t>         buf,
                            wasi_dircookie_t      cookie,
                            wasm_ptr<wasi_size_t> retptr0)
   {
      throw std::runtime_error("WASI fd_readdir not implemented");
   }

   uint32_t wasi_fd_seek(wasi_fd_t                 fd,
                         wasi_filedelta_t          offset,
                         uint32_t                  whence,  // uint8_t in WASI
                         wasm_ptr<wasi_filesize_t> newoffset)
   {
      // Validate file descriptor
      auto* file = get_file(fd);
      if (!file)
         return wasi_errno_badf;

      // Determine the equivalent POSIX whence value
      int posix_whence;
      switch (whence)
      {
         case 0:  // SEEK_SET
            posix_whence = SEEK_SET;
            break;
         case 1:  // SEEK_CUR
            posix_whence = SEEK_CUR;
            break;
         case 2:  // SEEK_END
            posix_whence = SEEK_END;
            break;
         default:
            return wasi_errno_inval;
      }

      // Perform the seek operation using fseek
      if (fseek(file->f, offset, posix_whence) != 0)
      {
         return wasi_errno_io;
      }

      // Get the new file position using ftell
      auto new_position = ftell(file->f);
      if (new_position < 0)
      {
         return wasi_errno_io;
      }

      // Store the new position in the provided wasm_ptr<wasi_filesize_t>
      *newoffset = new_position;

      return 0;
   }

   uint32_t wasi_fd_filestat_get(wasi_fd_t fd, wasm_ptr<wasi_filestat_t> stat_ptr)
   {
      wasi_filestat_t result = {};

      if (fd == STDIN_FILENO || fd == STDOUT_FILENO || fd == STDERR_FILENO)
      {
         result.filetype = wasi_filetype_character_device;
      }
      else if (fd == polyfill_root_dir_fd)
      {
         result.filetype = wasi_filetype_directory;
      }
      else if (auto file = get_file(fd))
      {
         int         fd = ::fileno(file->f);
         struct stat stat;
         if (::fstat(fd, &stat) < 0)
            return wasi_errno_badf;

         result = wasi_filestat_t::from_stat(stat);
      }
      else
      {
         return wasi_errno_badf;
      }
      *stat_ptr = result;
      return 0;
   }

   uint32_t wasi_fd_prestat_dir_name(wasi_fd_t fd, span<uint8_t> path)
   {
      if (fd != polyfill_root_dir_fd)
         return wasi_errno_badf;
      if (!path.empty())
         path[0] = '/';
      return 0;
   }

   uint32_t wasi_fd_prestat_get(wasi_fd_t fd, wasm_ptr<wasi_prestat_t> buf)
   {
      if (fd != polyfill_root_dir_fd)
         return wasi_errno_badf;
      buf->tag   = wasi_preopentype_dir;
      buf->u.dir = {
          1  // strlen("/")
      };
      return 0;
   }

   uint32_t wasi_path_filestat_get(wasi_fd_t                 fd,
                                   wasi_lookupflags_t        flags,
                                   span<const char>          path,
                                   wasm_ptr<wasi_filestat_t> stat_ptr)
   {
      if (fd != polyfill_root_dir_fd)
         return wasi_errno_badf;
      struct stat stat;
      std::string cPath = "/" + span_str(path);
      if (flags & wasi_lookupflags_symlink_follow)
      {
         if (::stat(cPath.c_str(), &stat) < 0)
            return wasi_errno_noent;
      }
      else
      {
         if (::lstat(cPath.c_str(), &stat) < 0)
            return wasi_errno_noent;
      }
      auto result = wasi_filestat_t::from_stat(stat);
      *stat_ptr   = result;
      return 0;
   }

   uint32_t wasi_path_open(wasi_fd_t          fd,
                           wasi_lookupflags_t dirflags,
                           span<const char>   path,
                           wasi_oflags_t      oflags,
                           wasi_rights_t      fs_rights_base,
                           wasi_rights_t      fs_rights_inherting,
                           uint32_t           fdflags,  // wasi_fdflags_t u16
                           wasm_ptr<int32_t>  opened_fd)
   {
      if (fd != polyfill_root_dir_fd)
         return wasi_errno_badf;

      if (oflags & wasi_oflags_directory)
         return wasi_errno_inval;
      if (fdflags & wasi_fdflags_nonblock)
         return wasi_errno_inval;

      bool read   = fs_rights_base & wasi_rights_fd_read;
      bool write  = fs_rights_base & wasi_rights_fd_write;
      bool create = oflags & wasi_oflags_creat;
      bool excl   = oflags & wasi_oflags_excl;
      bool trunc  = oflags & wasi_oflags_trunc;
      bool append = fdflags & wasi_fdflags_append;

      // TODO: move away from fopen to allow more flexible options
      const char* mode = nullptr;
      if (read && !create && !excl && !trunc && !append)
      {
         if (write)
            mode = "r+";
         else
            mode = "r";
      }
      else if (write && create && trunc)
      {
         if (read)
         {
            if (excl)
               mode = "w+x";
            else
               mode = "w+";
         }
         else
         {
            if (excl)
               mode = "wx";
            else
               mode = "w";
         }
      }
      else if (write && create && append)
      {
         if (read)
         {
            if (excl)
               mode = "a+x";
            else
               mode = "a+";
         }
         else
         {
            if (excl)
               mode = "ax";
            else
               mode = "a";
         }
      }

      if (!mode)
         return wasi_errno_inval;

      file f = fopen(("/" + span_str(path)).c_str(), mode);
      if (!f.f)
         return wasi_errno_noent;
      state.files.push_back(std::move(f));
      *opened_fd = state.files.size() - 1;
      return 0;
   }

   uint32_t wasi_fd_close(wasi_fd_t fd)
   {
      auto* file = get_file(fd);
      if (!file)
         return wasi_errno_badf;
      file->close();
      return 0;
   }

   uint32_t wasi_fd_write(wasi_fd_t             fd,
                          uint32_t              iovs,
                          uint32_t              iovs_len,
                          wasm_ptr<wasi_size_t> nwritten)
   {
      auto* file = get_file(fd);
      if (!file)
         return wasi_errno_badf;

      *nwritten = 0;

      for (uint32_t i = 0; i < iovs_len; ++i)
      {
         auto  iovs_item = iovec(iovs, i);
         void* iovs_buf  = memoryAt(iovs_item.buf, iovs_item.buf_len);

         if (iovs_item.buf_len && fwrite(iovs_buf, iovs_item.buf_len, 1, file->f) != 1)
         {
            return wasi_errno_io;
         }

         *nwritten += iovs_item.buf_len;
      }

      if ((fd == STDOUT_FILENO || fd == STDERR_FILENO) && fflush(file->f) != 0)
         return wasi_errno_io;

      return 0;
   }

   uint32_t wasi_fd_read(wasi_fd_t             fd,
                         uint32_t              iovs,
                         uint32_t              iovs_len,
                         wasm_ptr<wasi_size_t> nread)
   {
      auto* file = get_file(fd);
      if (!file)
         return wasi_errno_badf;

      *nread = 0;

      for (uint32_t i = 0; i < iovs_len; ++i)
      {
         auto  iovs_item = iovec(iovs, i);
         void* iovs_buf  = memoryAt(iovs_item.buf, iovs_item.buf_len);

         size_t bytes_read = fread(iovs_buf, 1, iovs_item.buf_len, file->f);
         *nread += bytes_read;

         if (bytes_read < iovs_item.buf_len && ferror(file->f))
            return wasi_errno_io;

         if (bytes_read < iovs_item.buf_len)
            return 0;
      }

      return 0;
   }

   uint32_t wasi_fd_tell(wasi_fd_t fd, wasm_ptr<wasi_filesize_t> newoffset)
   {
      // Validate file descriptor
      auto* file = get_file(fd);
      if (!file)
         return wasi_errno_badf;

      // Get the current file position using ftell
      auto position = ftell(file->f);
      if (position < 0)
      {
         return wasi_errno_io;
      }

      // Store the position in the provided wasm_ptr<wasi_filesize_t>
      *newoffset = position;

      return wasi_errno_success;
   }

   int32_t testerExecute(span<const char> command) { return system(span_str(command).c_str()); }

   test_chain& assert_chain(uint32_t chain, bool require_context = true)
   {
      if (chain >= state.chains.size() || !state.chains[chain])
         throw std::runtime_error("chain does not exist or was destroyed");
      auto& result = *state.chains[chain];
      if (require_context && !result.sys)
         throw std::runtime_error("chain was shut down");
      return result;
   }

   // The tester ABI: four sizing hints, as laid out by the guest.
   struct TesterDatabaseConfig
   {
      std::uint64_t hot_bytes;
      std::uint64_t warm_bytes;
      std::uint64_t cool_bytes;
      std::uint64_t cold_bytes;
   };

   uint32_t testerCreateChain(uint64_t hot_bytes,
                              uint64_t warm_bytes,
                              uint64_t cool_bytes,
                              uint64_t cold_bytes)
   {
      state.chains.push_back(std::make_unique<test_chain>(
          state, std::filesystem::temp_directory_path(),
          psibase::storage::database_config{hot_bytes, warm_bytes, cool_bytes, cold_bytes},
          psibase::storage::open_mode::temporary));
      return state.chains.size() - 1;
   }

   uint32_t testerOpenChain(span<const char>                          path,
                            wasi_oflags_t                             oflags,
                            wasi_rights_t                             fs_rights_base,
                            wasm_ptr<const TesterDatabaseConfig> config)
   {
      bool read   = fs_rights_base & wasi_rights_fd_read;
      bool write  = fs_rights_base & wasi_rights_fd_write;
      bool create = oflags & wasi_oflags_creat;
      bool excl   = oflags & wasi_oflags_excl;
      bool trunc  = oflags & wasi_oflags_trunc;

      psibase::check(read, "Chain cannot be opened without read access");

      psibase::storage::open_mode mode;
      if (!write)
      {
         if (create || excl || trunc)
            throw std::runtime_error("Unsupported combination of flags for openChain");
         mode = psibase::storage::open_mode::read_only;
      }
      else if (!create && !excl && !trunc)
         mode = psibase::storage::open_mode::read_write;
      else if (create && !excl && !trunc)
         mode = psibase::storage::open_mode::create;
      else if (create && excl && !trunc)
         mode = psibase::storage::open_mode::create_new;
      else if (create && !excl && trunc)
         mode = psibase::storage::open_mode::trunc;
      else
         throw std::runtime_error("Unsupported combination of flags for openChain");

      state.chains.push_back(std::make_unique<test_chain>(
          state, std::string_view{path.data(), path.size()},
          create ? psibase::storage::database_config{config->hot_bytes, config->warm_bytes,
                                                     config->cool_bytes, config->cold_bytes}
                 : psibase::storage::database_config{1 << 27, 1 << 27, 1 << 27, 1 << 27},
          mode));
      return state.chains.size() - 1;
   }

   uint32_t testerCloneChain(uint32_t chain)
   {
      auto& c = assert_chain(chain);
      state.chains.push_back(std::make_unique<test_chain>(c));
      return state.chains.size() - 1;
   }

   void testerGetFork(uint32_t chain, wasm_ptr<psibase::Checksum256> id)
   {
      if (!assert_chain(chain).setFork(*id))
         psibase::abortMessage("Cannot find state for block " + psibase::loggers::to_string(*id));
   }

   void testerDestroyChain(uint32_t chain)
   {
      assert_chain(chain, false);
      state.chains[chain].reset();
      while (!state.chains.empty() && !state.chains.back())
      {
         state.chains.pop_back();
      }
   }

   void testerStartBlock(uint32_t          chain_index,
                         int64_t           time_us,
                         uint64_t          producer,
                         psibase::TermNum  term,
                         psibase::BlockNum commitNum)
   {
      assert_chain(chain_index)
          .startBlock(psibase::BlockTime{psibase::MicroSeconds{time_us}},
                      psibase::AccountNumber{producer}, term, commitNum);
   }

   void testerFinishBlock(uint32_t chain_index) { assert_chain(chain_index).finishBlock(); }

   uint32_t testerRunAction(uint32_t         chain_index,
                            std::uint32_t    mode,
                            bool             head,
                            span<const char> args_packed)
   {
      auto&              chain = assert_chain(chain_index);
      auto               act   = psio::from_pssz<psibase::Action>(args_packed);

      auto dbMode = psibase::DbMode::from(static_cast<psibase::RunMode>(mode));

      BOOST_LOG_SCOPED_THREAD_TAG("TimeStamp", chain.getTimestamp());
      BOOST_LOG_SCOPED_THREAD_TAG("Host", chain.getName());
      psibase::TransactionTrace trace;
      trace.actionTraces.emplace_back();

      auto exec = [&](psibase::BlockContext& bc)
      {
         psibase::SignedTransaction  trx;
         psibase::TransactionContext tc{bc, trx, trace, dbMode};

         try
         {
            tc.execNonTrxAction(0, act, trace.actionTraces.back());
            PSIBASE_LOG(bc.trxLogger, debug)
                << act.service.str() << "::" << act.method.str() << " succeeded";
         }
         catch (std::exception& e)
         {
            if (!trace.error)
            {
               trace.error = e.what();
            }
            BOOST_LOG_SCOPED_LOGGER_TAG(bc.trxLogger, "Trace", trace);
            PSIBASE_LOG(bc.trxLogger, debug)
                << act.service.str() << "::" << act.method.str() << " failed: " << e.what();
         }
      };

      try
      {
         if (head)
         {
            psibase::BlockContext bc{*chain.sys, chain.head, chain.writer, true};
            bc.start();
            exec(bc);
         }
         else
         {
            exec(*chain.readBlockContext());
         }
      }
      catch (const std::exception& e)
      {
         trace.error = e.what();
      }

      if (trace.error && std::getenv("PSIBASE_TESTER_TRACE_ERRORS"))
         std::fprintf(stderr, "psitest native trace error: %s\n", trace.error->c_str());
      state.result_value = psio::to_pssz(trace);
      state.result_key.clear();
      psibase::check(state.result_value.size() <= 0xffff'ffffu, "Transaction trace too large");
      return state.result_value.size();
   }

   uint32_t testerPushTransaction(uint32_t chain_index, span<const char> args_packed)
   {
      auto&              chain     = assert_chain(chain_index);
      auto               signedTrx = psio::from_pssz<psibase::SignedTransaction>(args_packed);

      chain.start_if_needed();
      BOOST_LOG_SCOPED_THREAD_TAG("TimeStamp", chain.getTimestamp());
      BOOST_LOG_SCOPED_THREAD_TAG("Host", chain.getName());
      psibase::TransactionTrace trace;
      auto                      start_time = std::chrono::steady_clock::now();
      try
      {
         psibase::BlockContext proofBC{*chain.sys, chain.revisionAtBlockStart};
         proofBC.start(chain.blockContext->current.header.time);
         psibase::check(!proofBC.isGenesisBlock || signedTrx.proofs.empty(),
                        "Genesis block may not have proofs");
         psibase::check(signedTrx.proofs.size() == signedTrx.transaction->claims().size(),
                        "proofs and claims must have same size");
         // Match node admission: objective consumers may rely on verified claims.
         // Proof time is deliberately outside objective transaction timing/limits.
         for (std::size_t i = 0; i < signedTrx.proofs.size(); ++i)
            proofBC.verifyProof(signedTrx, trace, i, std::nullopt, nullptr, {});


         if (signedTrx.subjectiveData)
         {
            chain.blockContext->isProducing = false;
            auto resetProducing = psibase::finally{[&] { chain.blockContext->isProducing = true; }};
            chain.blockContext->replayTransaction(std::move(signedTrx), trace);
         }
         else
         {
            chain.blockContext->pushTransaction(std::move(signedTrx), trace, std::nullopt);
         }
      }
      catch (const std::exception& e)
      {
         if (!trace.error)
         {
            trace.error = e.what();
         }
      }

      auto us = std::chrono::duration_cast<std::chrono::microseconds>(
          std::chrono::steady_clock::now() - start_time);

      if (state.additional_args[cl_flags::timing])
      {
         std::cout << "psibase transaction took " << us.count() << " us\n";
      }

      // std::cout << eosio::format_json(trace) << "\n";
      if (trace.error && std::getenv("PSIBASE_TESTER_TRACE_ERRORS"))
         std::fprintf(stderr, "psitest native trace error: %s\n", trace.error->c_str());
      state.result_value = psio::to_pssz(trace);
      state.result_key.clear();
      psibase::check(state.result_value.size() <= 0xffff'ffffu, "Transaction trace too large");
      return state.result_value.size();
   }

   std::int32_t testerHttpRequest(uint32_t chain_index, span<const char> args_packed)
   {
      auto& chain = assert_chain(chain_index);

      auto startTime = std::chrono::steady_clock::now();
      psibase::check(psio::validate_pssz<psibase::HttpRequest>(args_packed).ok(),
                     "HttpRequest has invalid format");
      auto req       = psio::pssz_view<psibase::HttpRequest>(args_packed);
      BOOST_LOG_SCOPED_LOGGER_TAG(chain.logger, "RequestMethod", req.method().unpack());
      BOOST_LOG_SCOPED_LOGGER_TAG(chain.logger, "RequestTarget", req.target().unpack());
      BOOST_LOG_SCOPED_LOGGER_TAG(chain.logger, "RequestHost", req.host().unpack());

      BOOST_LOG_SCOPED_THREAD_TAG("TimeStamp", chain.getTimestamp());
      BOOST_LOG_SCOPED_THREAD_TAG("Host", chain.getName());

      psibase::BlockContext bc{*chain.sys, chain.head, chain.writer, true};
      bc.start();

      std::int32_t fd;

      auto socket = std::make_shared<HttpSocket>();
      socket->files = chain.sys->files;
      if (auto pos = std::ranges::find(state.sockets, nullptr); pos != state.sockets.end())
      {
         *pos = socket;
         fd   = pos - state.sockets.begin();
      }
      else
      {
         psibase::check(state.sockets.size() <= 0x7fffffff, "Too many open sockets");
         fd = state.sockets.size();
         state.sockets.push_back(socket);
      }

      {
         psibase::SignedTransaction  trx;
         psibase::TransactionContext tc{bc, trx, socket->trace, psibase::DbMode::rpc()};
         psibase::ActionTrace&       atrace        = socket->trace.actionTraces.emplace_back();
         auto                        startExecTime = std::chrono::steady_clock::now();

         chain.sys->sockets->add(*chain.writer, socket, &tc.ownedSockets);
         auto setStatus = psibase::finally(
             [&]
             {
                auto endExecTime = std::chrono::steady_clock::now();

                socket->queryTimes.packTime = std::chrono::duration_cast<std::chrono::microseconds>(
                    startExecTime - startTime);
                socket->queryTimes.serviceLoadTime =
                    std::chrono::duration_cast<std::chrono::microseconds>(
                        endExecTime - startExecTime - tc.getBillableTime());
                socket->queryTimes.databaseTime =
                    std::chrono::duration_cast<std::chrono::microseconds>(tc.databaseTime);
                socket->queryTimes.wasmExecTime =
                    std::chrono::duration_cast<std::chrono::microseconds>(tc.getBillableTime() -
                                                                          tc.databaseTime);
                socket->queryTimes.startTime = startTime;
             });
         try
         {
            psibase::Action action{
                .sender  = psibase::AccountNumber(),
                .service = psibase::proxyServiceNum,
                .rawData = psio::to_pssz(std::tuple(socket->id, req.unpack())),
            };
            tc.execServe(action, atrace);
         }
         catch (std::exception& e)
         {
            socket->trace.error = e.what();
         }
      }

      socket->chain = &chain;
      if (!socket->response.empty())
      {
         socket->logResponse();
      }
      else
      {
         auto trace = std::move(socket->trace);
         socket->trace.error.reset();
         auto  error  = trace.error;
         auto& logger = chain.logger;
         BOOST_LOG_SCOPED_LOGGER_TAG(logger, "Trace", std::move(trace));
         if (error)
            PSIBASE_LOG(logger, warning)
                << psibase::proxyServiceNum.str() << "::serve failed: " << *error;
         else
            PSIBASE_LOG(logger, info) << psibase::proxyServiceNum.str() << "::serve succeeded";
      }

      return fd;
   }

   std::uint32_t testerSocketRecv(std::int32_t fd, wasm_ptr<wasi_size_t> nbytes)
   {
      if (fd < 0 || fd >= state.sockets.size() || !state.sockets[fd])
         return wasi_errno_badf;
      if (state.sockets[fd]->response.empty())
         return wasi_errno_again;
      state.result_value = std::move(state.sockets[fd]->response);
      state.result_key.clear();
      *nbytes = state.result_value.size();

      psibase::check(state.sockets[fd]->closed, "Socket is not ready to close");
      psibase::check(!state.sockets[fd]->notifyClose,
                     "Not implemented: socket close notifications");
      if (auto parent = state.sockets[fd]->weak_sockets.lock())
      {
         state.sockets[fd]->remove(*parent->sharedDb.createWriter());
      }

      state.sockets[fd].reset();
      return 0;
   }

   psibase::NativeFunctions& native(std::uint32_t chain_index)
   {
      return assert_chain(chain_index).native();
   }

   psibase::Database& database(std::uint32_t chain_index)
   {
      return assert_chain(chain_index).database();
   }

   void setResult(psibase::NativeFunctions& n)
   {
      state.result_key   = std::move(n.result_key);
      state.result_value = std::move(n.result_value);
   }

   uint32_t setResult(const std::optional<std::span<const char>>& o)
   {
      state.result_key.clear();
      if (o)
      {
         state.result_value.assign(o->begin(), o->end());
         return state.result_value.size();
      }
      else
      {
         state.result_value.clear();
         return -1;
      }
   }
   uint32_t setResult(const std::optional<psibase::Database::KVResult>& o)
   {
      if (!o)
      {
         state.result_key.clear();
         state.result_value.clear();
         return -1;
      }
      else
      {
         state.result_key.assign(o->key.begin(), o->key.end());
         state.result_value.assign(o->value.begin(), o->value.end());
         return state.result_value.size();
      }
   }

   ScopedCheckoutSubjective getDbRead(test_chain& chain, std::uint32_t db)
   {
      switch (db)
      {
         case uint32_t(psibase::DbId::service):
         case uint32_t(psibase::DbId::native):
         case uint32_t(psibase::DbId::writeOnly):
         case uint32_t(psibase::DbId::blockLog):
         case uint32_t(psibase::DbId::blockProof):
         case uint32_t(psibase::DbId::prevAuthServices):
            return (psibase::DbId)db;
         case uint32_t(psibase::DbId::subjective):
         case uint32_t(psibase::DbId::nativeSubjective):
         case uint32_t(psibase::DbId::session):
         case uint32_t(psibase::DbId::nativeSession):
            return {chain, (psibase::DbId)db};
         default:
            throw std::runtime_error("may not read this db, or must use another intrinsic");
      }
   }

   ScopedCheckoutSubjective getDbWrite(test_chain& chain, std::uint32_t db)
   {
      switch (db)
      {
         case uint32_t(psibase::DbId::service):
         case uint32_t(psibase::DbId::native):
         case uint32_t(psibase::DbId::prevAuthServices):
            psibase::check(!chain.blockContext, "may not write this db while building a block");
            return (psibase::DbId)db;
         case uint32_t(psibase::DbId::subjective):
         case uint32_t(psibase::DbId::nativeSubjective):
         case uint32_t(psibase::DbId::session):
         case uint32_t(psibase::DbId::nativeSession):
            return {chain, (psibase::DbId)db};
         case uint32_t(psibase::DbId::writeOnly):
         case uint32_t(psibase::DbId::blockLog):
         case uint32_t(psibase::DbId::blockProof):
            return (psibase::DbId)db;
         default:
            throw std::runtime_error("may not write this db, or must use another intrinsic");
      }
   }

   uint32_t getResult(std::span<char> dest, uint32_t offset)
   {
      if (offset < state.result_value.size() && dest.size())
         memcpy(dest.data(), state.result_value.data() + offset,
                std::min(state.result_value.size() - offset, dest.size()));
      return state.result_value.size();
   }

   uint32_t getKey(std::span<char> dest)
   {
      if (!state.result_key.empty())
         memcpy(dest.data(), state.result_key.data(),
                std::min(state.result_key.size(), dest.size()));
      return state.result_key.size();
   }

   uint32_t kvGet(std::uint32_t chain_index, uint32_t db, std::span<const char> key)
   {
      auto& chain = assert_chain(chain_index);
      return setResult(
          chain.database().kvGetRaw(getDbRead(chain, db).db, {key.data(), key.size()}));
   }

   uint32_t kvGreaterEqual(std::uint32_t         chain_index,
                           uint32_t              db,
                           std::span<const char> key,
                           uint32_t              matchKeySize)
   {
      psibase::check(matchKeySize <= key.size(), "matchKeySize is larger than key");
      auto& chain = assert_chain(chain_index);
      return setResult(chain.database().kvGreaterEqualRaw(getDbRead(chain, db).db,
                                                          {key.data(), key.size()}, matchKeySize));
   }

   uint32_t kvLessThan(std::uint32_t         chain_index,
                       uint32_t              db,
                       std::span<const char> key,
                       uint32_t              matchKeySize)
   {
      psibase::check(matchKeySize <= key.size(), "matchKeySize is larger than key");
      auto& chain = assert_chain(chain_index);
      return setResult(chain.database().kvLessThanRaw(getDbRead(chain, db).db,
                                                      {key.data(), key.size()}, matchKeySize));
   }

   uint32_t kvMax(std::uint32_t chain_index, uint32_t db, std::span<const char> key)
   {
      auto& chain = assert_chain(chain_index);
      return setResult(
          chain.database().kvMaxRaw(getDbRead(chain, db).db, {key.data(), key.size()}));
   }

   void kvPut(std::uint32_t         chain_index,
              uint32_t              db,
              std::span<const char> key,
              std::span<const char> value)
   {
      auto& chain = assert_chain(chain_index);
      state.result_key.clear();
      state.result_value.clear();
      chain.database().kvPutRaw(getDbWrite(chain, db).db, {key.data(), key.size()},
                                {value.data(), value.size()});
   }

   void kvRemove(std::uint32_t chain_index, uint32_t db, std::span<const char> key)
   {
      auto& chain = assert_chain(chain_index);
      state.result_key.clear();
      state.result_value.clear();
      chain.database().kvRemoveRaw(getDbWrite(chain, db).db, {key.data(), key.size()});
   }

   void checkoutSubjective(std::uint32_t chain_index)
   {
      assert_chain(chain_index).native().checkoutSubjective();
   }
   bool commitSubjective(std::uint32_t chain_index)
   {
      return assert_chain(chain_index).native().commitSubjective();
   }
   void abortSubjective(std::uint32_t chain_index)
   {
      assert_chain(chain_index).native().abortSubjective();
   }

   void commitState(std::uint32_t chain_index) { assert_chain(chain_index).writeRevision(); }

   uint32_t kvGetTransactionUsage(std::uint32_t chain_index)
   {
      auto& n      = native(chain_index);
      auto  result = n.kvGetTransactionUsage();
      setResult(n);
      return result;
   }
};  // callbacks

callbacks* callbacks::single = nullptr;  // TODO: remove

void backtrace()
{
   if (callbacks::single)
      callbacks::single->backtrace();
}

// The imports a test module may have. One it has that is not here fails its
// instantiation, with the import named.
void register_callbacks(wt::runtime<callbacks>& rt)
{
   // Psibase Intrinsics
   rt.add<&callbacks::abortMessage>("psibase", "abortMessage");
   rt.add<&callbacks::getResult>("psibase", "getResult");
   rt.add<&callbacks::getKey>("psibase", "getKey");
   rt.add<&callbacks::kvGet>("psibase", "kvGet");
   rt.add<&callbacks::kvGreaterEqual>("psibase", "kvGreaterEqual");
   rt.add<&callbacks::kvLessThan>("psibase", "kvLessThan");
   rt.add<&callbacks::kvMax>("psibase", "kvMax");
   rt.add<&callbacks::kvPut>("psibase", "kvPut");
   rt.add<&callbacks::kvRemove>("psibase", "kvRemove");
   rt.add<&callbacks::kvGetTransactionUsage>("psibase", "kvGetTransactionUsage");

   // Tester Intrinsics
   rt.add<&callbacks::testerCreateChain>("psibase", "createChain");
   rt.add<&callbacks::testerOpenChain>("psibase", "openChain");
   rt.add<&callbacks::testerCloneChain>("psibase", "cloneChain");
   rt.add<&callbacks::testerGetFork>("psibase", "getFork");
   rt.add<&callbacks::testerDestroyChain>("psibase", "destroyChain");
   rt.add<&callbacks::testerStartBlock>("psibase", "startBlock");
   rt.add<&callbacks::testerFinishBlock>("psibase", "finishBlock");
   rt.add<&callbacks::checkoutSubjective>("psibase", "checkoutSubjective");
   rt.add<&callbacks::commitSubjective>("psibase", "commitSubjective");
   rt.add<&callbacks::abortSubjective>("psibase", "abortSubjective");
   rt.add<&callbacks::commitState>("psibase", "commitState");
   rt.add<&callbacks::testerRunAction>("psibase", "runAction");
   rt.add<&callbacks::testerPushTransaction>("psibase", "pushTransaction");
   rt.add<&callbacks::testerHttpRequest>("psibase", "httpRequest");
   rt.add<&callbacks::testerSocketRecv>("psibase", "socketRecv");
   rt.add<&callbacks::testerExecute>("env", "testerExecute");

   // WASI functions
   rt.add<&callbacks::wasi_args_get>("wasi_snapshot_preview1", "args_get");
   rt.add<&callbacks::wasi_args_sizes_get>("wasi_snapshot_preview1", "args_sizes_get");
   rt.add<&callbacks::wasi_clock_time_get>("wasi_snapshot_preview1", "clock_time_get");
   rt.add<&callbacks::wasi_environ_get>("wasi_snapshot_preview1", "environ_get");
   rt.add<&callbacks::wasi_environ_sizes_get>("wasi_snapshot_preview1", "environ_sizes_get");
   rt.add<&callbacks::wasi_fd_close>("wasi_snapshot_preview1", "fd_close");
   rt.add<&callbacks::wasi_fd_fdstat_get>("wasi_snapshot_preview1", "fd_fdstat_get");
   rt.add<&callbacks::wasi_fd_fdstat_set_flags>("wasi_snapshot_preview1",
                                                    "fd_fdstat_set_flags");
   rt.add<&callbacks::wasi_fd_filestat_get>("wasi_snapshot_preview1", "fd_filestat_get");
   rt.add<&callbacks::wasi_fd_prestat_dir_name>("wasi_snapshot_preview1",
                                                    "fd_prestat_dir_name");
   rt.add<&callbacks::wasi_fd_prestat_get>("wasi_snapshot_preview1", "fd_prestat_get");
   rt.add<&callbacks::wasi_fd_read>("wasi_snapshot_preview1", "fd_read");
   rt.add<&callbacks::wasi_fd_readdir>("wasi_snapshot_preview1", "fd_readdir");
   rt.add<&callbacks::wasi_fd_seek>("wasi_snapshot_preview1", "fd_seek");
   rt.add<&callbacks::wasi_fd_tell>("wasi_snapshot_preview1", "fd_tell");
   rt.add<&callbacks::wasi_fd_write>("wasi_snapshot_preview1", "fd_write");
   rt.add<&callbacks::wasi_path_filestat_get>("wasi_snapshot_preview1", "path_filestat_get");
   rt.add<&callbacks::wasi_path_open>("wasi_snapshot_preview1", "path_open");
   rt.add<&callbacks::wasi_proc_exit>("wasi_snapshot_preview1", "proc_exit");
   rt.add<&callbacks::wasi_random_get>("wasi_snapshot_preview1", "random_get");
   rt.add<&callbacks::wasi_sched_yield>("wasi_snapshot_preview1", "sched_yield");
   rt.link();
}

void fill_substitutions(::state& state, const std::map<std::string, std::string>& substitutions)
{
   for (auto& [a, b] : substitutions)
   {
      std::vector<uint8_t> acode;
      std::vector<uint8_t> bcode;
      try
      {
         acode = psizam::read_wasm(a);
      }
      catch (...)
      {
         std::cerr << "skipping substitution: can not read " << a << "\n";
         continue;
      }
      try
      {
         bcode = psizam::read_wasm(b);
      }
      catch (...)
      {
         std::cerr << "skipping substitution: can not read " << b << "\n";
         continue;
      }
      // TODO
      // auto ahash = fc::sha256::hash((const char*)acode.data(), acode.size());
      // auto bhash = fc::sha256::hash((const char*)bcode.data(), bcode.size());
      // state.cache.substitutions[ahash] = bhash;
      // state.cache.codes[bhash] = std::move(bcode);
   }
}

// Stops the test module once it has run for `limit`: the one bound psitest
// itself puts on a test's run time, and only when asked (--timeout). The
// module stops at its next loop iteration or function entry; a host function
// in progress, which includes every service call, finishes first.
struct Deadline
{
   Deadline(wt::interrupter interrupter, std::optional<std::chrono::milliseconds> limit)
   {
      if (!limit)
         return;
      thread = std::thread{[this, interrupter = std::move(interrupter), limit = *limit]
                           {
                              std::unique_lock lock{mutex};
                              if (!done.wait_for(lock, limit, [&] { return finished; }))
                              {
                                 expired = true;
                                 interrupter.fire();
                              }
                           }};
   }
   ~Deadline()
   {
      {
         std::lock_guard lock{mutex};
         finished = true;
      }
      done.notify_all();
      if (thread.joinable())
         thread.join();
   }
   std::mutex              mutex;
   std::condition_variable done;
   bool                    finished = false;
   std::atomic<bool>       expired  = false;
   std::thread             thread;
};

struct timeout_exception : std::exception
{
   const char* what() const noexcept override { return "timeout"; }
};

struct RunOptions
{
   cl_flags_t                               additional_args;
   // --timeout
   std::optional<std::chrono::milliseconds> timeout;
   // --debug-module
   bool debugger = false;
};

static void run(const char*                               wasm,
                const std::vector<std::string>&           args,
                const std::map<std::string, std::string>& substitutions,
                const RunOptions&                         options)
{
   auto code = psizam::read_wasm(wasm);

   const auto             engineOptions = test_module::engineOptions(options.debugger);
   wt::runtime<callbacks> runtime{engineOptions};
   register_callbacks(runtime);
   auto module = test_module::obtain(runtime, code, engineOptions);

   ::state state{wasm, nullptr, args, options.additional_args};
   fill_substitutions(state, substitutions);
   callbacks cb{state};
   state.files.emplace_back(stdin, false);
   state.files.emplace_back(stdout, false);
   state.files.emplace_back(stderr, false);
   state.files.emplace_back();  // reserve space for fd 3: root dir

   wt::instance<callbacks> instance{runtime, module, cb, test_module::instanceLimits};
   state.instance = &instance;
   auto detach    = psibase::finally{[&] { state.instance = nullptr; }};
   Deadline deadline{instance.make_interrupter(), options.timeout};
   try
   {
      instance.call<void>("_start");
   }
   catch (const wt::trap& e)
   {
      if (e.kind == wt::trap_kind::interrupt && deadline.expired)
         throw timeout_exception{};
      // Where the module was. A host function that threw has said so itself.
      fprintf(stderr, "Generating backtrace...\n");
      callbacks::printFrames(instance.failure_backtrace());
      throw;
   }
}

struct ConsoleLog
{
   std::string type   = "console";
   std::string filter = "Severity > critical";
   std::string format =
       "[{TimeStamp}] [{Severity}] [{Host}]{?: [{Service}]}: {Message}{?: {TransactionId}}{?: "
       "{BlockId}: "
       "{BlockHeader}}{?RequestMethod:: {RequestMethod} {RequestHost}{RequestTarget}{?: "
       "{ResponseStatus}{?: {ResponseBytes}}}}{?: {ResponseTime} µs}{Indent:4:{TraceConsole}}";
};
PSIO_REFLECT(ConsoleLog, type, filter, format);

struct Loggers
{
   ConsoleLog stderr;
};
PSIO_REFLECT(Loggers, stderr);

const char usage[] = "USAGE: psitest [OPTIONS] file.wasm [args for wasm]...\n";
const char help[]  = R"(
OPTIONS:
      -h, --help

            Show this message

      -V, --version

            Print version information

      -v, --verbose

            Show detailed logging

      --log-filter filter

            Set a filter for logging. This can be used to set a more specific
            log filter than -v.

      -s service.wasm debug.wasm
      --subst service.wasm debug.wasm

            Whenever service.wasm needs to run, substitute debug.wasm in its
            place and enable debugging support. This bypasses size limits and
            other constraints on debug.wasm. psibase still enforces
            constraints on service.wasm. (repeatable)

      --timing

            Show how long transactions take in µs.

      --timeout seconds

            Stop the test module, and fail, once it has run this long. Can
            also be set with PSITEST_TIMEOUT. Without it psitest does not
            limit how long a test runs.

      --debug-module

            Give an attached debugger (gdb, lldb) the test module's compiled
            code and source lines. The module is compiled again for this,
            more slowly. Can also be turned on with PSITEST_DEBUG_MODULE=1.

      --debug-services

            Run the services of test chains with debugging support: log
            where in a service a failed call was, and register compiled
            services with an attached debugger (gdb, lldb). Shows warnings
            unless -v or --log-filter says otherwise. Can also be turned on
            with PSIBASE_DEBUG_SERVICES=1.
)";

int main(int argc, char* argv[])
{
   // Must run before any additional threads are started
   {
      auto prefix = psibase::installPrefix();
      ::setenv("PSIBASE_DATADIR", (prefix / "share" / "psibase").c_str(), 1);
      // WASI libc resolves relative paths using PWD. Test launchers can
      // change cwd without updating that inherited environment variable.
      ::setenv("PWD", boost::filesystem::current_path().c_str(), 1);
   }
   bool                               show_usage   = false;
   bool                               error        = false;
   bool                               show_version = false;
   int                                verbose      = 0;
   Loggers                            logConfig;
   std::map<std::string, std::string> substitutions;
   RunOptions                         options;
   auto&                              additional_args = options.additional_args;
   // Fractions of a second are accepted. False if `text` is not a time.
   auto parseTimeout = [&](const char* text)
   {
      char*  end     = nullptr;
      double seconds = std::strtod(text, &end);
      if (end == text || *end || !(seconds > 0) || seconds > 1e9)
         return false;
      options.timeout = std::chrono::milliseconds{static_cast<std::int64_t>(seconds * 1000)};
      return true;
   };
   if (const char* text = std::getenv("PSITEST_TIMEOUT"); text && *text)
   {
      if (!parseTimeout(text))
      {
         std::cerr << "PSITEST_TIMEOUT is not a number of seconds: " << text << "\n";
         return 1;
      }
   }
   if (const char* text = std::getenv("PSITEST_DEBUG_MODULE"))
      options.debugger = std::string_view(text) == "1";

   int next_arg = 1;
   while (next_arg < argc && argv[next_arg][0] == '-')
   {
      if (!strcmp(argv[next_arg], "-h") || !strcmp(argv[next_arg], "--help"))
         show_usage = true;
      else if (!strcmp(argv[next_arg], "-V") || !strcmp(argv[next_arg], "--version"))
         show_version = true;
      else if (!strcmp(argv[next_arg], "-v") || !strcmp(argv[next_arg], "--verbose"))
      {
         ++verbose;
      }
      else if (!strcmp(argv[next_arg], "--log-filter"))
      {
         ++next_arg;
         if (next_arg >= argc)
         {
            std::cerr << "Missing argument for " << argv[next_arg - 1] << std::endl;
            error = true;
         }
         else
         {
            verbose                 = 0;
            logConfig.stderr.filter = argv[next_arg];
         }
      }
      else if (!strcmp(argv[next_arg], "--timing"))
      {
         additional_args[cl_flags::timing] = true;
      }
      else if (!strcmp(argv[next_arg], "--debug-services"))
      {
         psibase::vm::setServiceDebugging(true);
      }
      else if (!strcmp(argv[next_arg], "--debug-module"))
      {
         options.debugger = true;
      }
      else if (!strcmp(argv[next_arg], "--timeout"))
      {
         ++next_arg;
         if (next_arg >= argc || !parseTimeout(argv[next_arg]))
         {
            std::cerr << "--timeout needs a number of seconds\n";
            error = true;
         }
      }
      // TODO
      // else if (!strcmp(argv[next_arg], "-s") || !strcmp(argv[next_arg], "--subst"))
      // {
      //    next_arg += 2;
      //    if (next_arg >= argc)
      //    {
      //       std::cerr << argv[next_arg - 2] << " needs 2 args\n";
      //       error = true;
      //    }
      //    else
      //    {
      //       substitutions[argv[next_arg - 1]] = argv[next_arg];
      //    }
      // }
      else
      {
         std::cerr << "unknown option: " << argv[next_arg] << "\n";
         error = true;
      }
      ++next_arg;
   }
   if (show_version)
   {
      // The engines are part of what a test result means: say which.
      std::cerr << "psitest " << PSIBASE_VERSION_MAJOR << "." << PSIBASE_VERSION_MINOR << "."
                << PSIBASE_VERSION_PATCH << "\n"
                << "test module engine: " << test_module::engineName << " ("
                << wt::build_identity() << ")\n"
                << "service engine: " << psibase::vm::selected().name << "\n";
      return 0;
   }
   if (next_arg >= argc)
      error = true;
   if (show_usage || error)
   {
      std::cerr << usage;
      if (show_usage)
         std::cerr << help;
      return error;
   }
   // A service's backtrace is logged as a warning, which the tester does not
   // show by default. Someone who asked to debug services wants to see it.
   if (psibase::vm::serviceDebugging() && logConfig.stderr.filter == ConsoleLog{}.filter)
   {
      logConfig.stderr.filter = "Severity >= warning";
   }
   if (verbose == 1)
   {
      logConfig.stderr.filter = "Severity >= info";
   }
   else if (verbose >= 2)
   {
      logConfig.stderr.filter = "Severity >= debug";
   }
   try
   {
      psibase::loggers::configure(psibase::loggers::Config::fromJson(
          psio::from_ijson<psio::json_value>(psio::to_ijson(logConfig))));
      std::vector<std::string> args{argv + next_arg, argv + argc};
      psibase::ExecutionContext::registerHostFunctions();
      run(argv[next_arg], args, substitutions, options);
      return 0;
   }
   catch (::timeout_exception&)
   {
      std::cerr << "psitest: the test module was stopped: it ran longer than the "
                << options.timeout->count() / 1000.0 << " s it was given (--timeout)\n";
      return 124;
   }
   catch (::assert_exception& e)
   {
      std::cerr << "tester wasm asserted: " << e.what() << "\n";
   }
   catch (wt::trap& e)
   {
      std::cerr << "test module trapped: " << e.what() << "\n";
   }
   catch (wt::host_memory_error& e)
   {
      std::cerr << "test module passed a host function memory it does not have: " << e.what()
                << "\n";
   }
   catch (wt::error& e)
   {
      // Nothing else is tried: the test module runs on this engine or not
      // at all.
      std::cerr << "test module failed on " << test_module::engineName << ": " << e.what()
                << "\n";
   }
   catch (::exit_exception& e)
   {
      return e.code;
   }
   catch (std::exception& e)
   {
      std::cerr << "std::exception: " << e.what() << "\n";
   }
   return 1;
}
