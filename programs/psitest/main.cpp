#include <boost/filesystem/operations.hpp>
#include <debug_eos_vm/debug_eos_vm.hpp>
#include <psibase/ActionContext.hpp>
#include <psibase/NativeFunctions.hpp>
#include <psibase/Prover.hpp>
#include <psibase/RawNativeFunctions.hpp>
#include <psibase/Socket.hpp>
#include <psibase/Watchdog.hpp>
#include <psibase/log.hpp>
#include <psibase/prefix.hpp>
#include <psibase/serviceEntry.hpp>
#include <psibase/version.hpp>
#include <psio/finally.hpp>
#include <psio/to_bin.hpp>
#include <psio/to_json.hpp>
#include <psio/view.hpp>

#include <stdio.h>
#include <bitset>
#include <chrono>
#include <optional>
#include <random>

#include <sys/stat.h>

using namespace std::literals;

using eosio::vm::span;
using psibase::WatchdogManager;
using psio::convert_to_bin;

struct callbacks;
using rhf_t = eosio::vm::registered_host_functions<callbacks>;

using cl_flags_t = std::bitset<16>;
enum cl_flags
{
   timing
};

void backtrace();

struct vm_options
{
   static constexpr bool          enable_simd          = true;
   static constexpr bool          enable_bulk_memory   = true;
   static constexpr std::uint32_t max_func_local_bytes = 1024 * 1024;
   static constexpr std::uint32_t max_stack_bytes      = 1024 * 1024;
};

#ifdef __x86_64__
template <>
void eosio::vm::machine_code_writer<eosio::vm::jit_execution_context<callbacks, true>,
                                    true>::on_unreachable()
{
   backtrace();
   eosio::vm::throw_<wasm_interpreter_exception>("unreachable");
}
#endif

using backend_t = eosio::vm::backend<  //
    rhf_t,
#ifdef __x86_64__
    eosio::vm::jit_profile,
#else
    eosio::vm::interpreter,
#endif
    vm_options,
    debug_eos_vm::debug_instr_map>;

inline constexpr int max_backtrace_frames = 512;

inline constexpr int      block_interval_ms   = 500;
inline constexpr int      block_interval_us   = block_interval_ms * 1000;
inline constexpr uint32_t billed_cpu_time_use = 2000;

inline constexpr int32_t polyfill_root_dir_fd = 3;

/** WASI Types */
using wasi_errno_t                                = uint16_t;
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
   dwarf::info&                             dwarf_info;
   eosio::vm::wasm_allocator&               wa;
   backend_t&                               backend;
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
using wasm_ptr = eosio::vm::argument_proxy<T*>;

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

struct test_chain
{
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
                                 std::make_shared<psibase::Sockets>()});
      state.shared_memory_cache.init(*sys);
      head = this->db.getHead();
   }

   test_chain(::state&                         state,
              const std::filesystem::path&     path,
              const triedent::database_config& config,
              triedent::open_mode              mode)
       : test_chain{state, {path, config, mode}}
   {
   }

   explicit test_chain(const test_chain& other) : test_chain{other.state, other.db.clone()} {}

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

   void startBlock(std::optional<psibase::BlockTime> time = std::nullopt)
   {
      // TODO: undo control
      finishBlock();
      revisionAtBlockStart = head;
      nativeFunctions.reset();
      nativeFunctionsActionContext.reset();
      nativeFunctionsTransactionContext.reset();
      altBlockContext.reset();

      blockContext =
          std::make_unique<psibase::BlockContext>(*sys, revisionAtBlockStart, writer, true);

      auto producer = psibase::AccountNumber("firstproducer");
      auto status =
          blockContext->db.kvGet<psibase::StatusRow>(psibase::StatusRow::db, psibase::statusKey());
      if (status.has_value())
      {
         if (status->consensus.next)
         {
            std::visit(
                [&](const auto& c)
                {
                   if (!c.producers.empty())
                   {
                      producer = c.producers.front().name;
                   }
                },
                status->consensus.next->consensus.data);
         }
         if (!status->consensus.next ||
             status->current.commitNum < status->consensus.next->blockNum)
         {
            std::visit(
                [&](const auto& c)
                {
                   if (!c.producers.empty())
                   {
                      producer = c.producers.front().name;
                   }
                },
                status->consensus.current.data);
         }
      }

      blockContext->start(time, producer);
      blockContext->callStartBlock();
   }

   void start_if_needed()
   {
      if (!blockContext)
         startBlock();
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
             *blockContext, dummyTransaction, *nativeFunctionsTrace, true, false, true);
         nativeFunctionsActionContext = std::make_unique<psibase::ActionContext>(
             psibase::ActionContext{*nativeFunctionsTransactionContext, dummyAction,
                                    nativeFunctionsTrace->actionTraces[0]});
         nativeFunctions = std::make_unique<psibase::NativeFunctions>(
             psibase::NativeFunctions{blockContext->db,
                                      *nativeFunctionsTransactionContext,
                                      true,
                                      false,
                                      true,
                                      false,
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
   HttpSocket() { this->once = true; }
   void autoClose(const std::optional<std::string>& message) noexcept override
   {
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
      sendImpl(psio::to_frac(reply));
   }
   void send(std::span<const char> data) override
   {
      auto reply  = psio::view<const psibase::HttpReply>{data};
      auto status = reply.status().unpack();
      switch (status)
      {
         case psibase::HttpStatus::ok:
         case psibase::HttpStatus::notFound:
            break;
         default:
            psibase::check(false, "HTTP response code not allowed: " +
                                      std::to_string(static_cast<std::uint16_t>(status)));
      }
      sendImpl(std::vector(data.begin(), data.end()));
   }
   void sendImpl(std::vector<char>&& reply)
   {
      response = std::move(reply);
      if (chain)
         logResponse();
   }
   void logResponse()
   {
      auto view    = psio::view<const psibase::HttpReply>(psio::prevalidated{response});
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

   void backtrace()
   {
      fprintf(stderr, "Generating backtrace...\n");
      void* data[max_backtrace_frames];
      int   count =
          state.backend.get_context().backtrace(data, sizeof(data) / sizeof(data[0]), nullptr);
      for (int i = 0; i < count; ++i)
      {
         auto& di          = state.dwarf_info;
         auto  file_offset = state.backend.get_debug().translate(data[i]);
         if (file_offset == 0xffff'ffff)
            continue;
         const auto* loc = di.get_location(file_offset - di.wasm_code_offset);
         const auto* sub = di.get_subprogram(file_offset - di.wasm_code_offset);
         if (loc)
            fprintf(stderr, "%s:%d", di.files[loc->file_index].c_str(), loc->line);
         else
            fprintf(stderr, "<wasm address 0x%08x>", file_offset - di.wasm_code_offset);
         if (sub)
            fprintf(stderr, ": %s", sub->demangled_name.c_str());
         fprintf(stderr, "\n");
      }
   }

   void check_bounds(void* data, size_t size)
   {
      volatile auto check = *((const char*)data + size - 1);
      eosio::vm::ignore_unused_variable_warning(check);
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
      auto* memory   = state.backend.get_context().linear_memory();
      auto  get_argv = [&]() -> uint32_t& { return *reinterpret_cast<uint32_t*>(memory + argv); };
      auto  get_argv_buf = [&]() -> uint8_t&
      { return *reinterpret_cast<uint8_t*>(memory + argv_buf); };

      for (auto& a : state.args)
      {
         get_argv() = argv_buf;
         argv += 4;
         for (auto ch : a)
         {
            get_argv_buf() = ch;
            ++argv_buf;
         }
         get_argv_buf() = 0;
         ++argv_buf;
      }
      return 0;
   };

   int32_t wasi_environ_sizes_get(wasm_ptr<uint32_t> environc, wasm_ptr<uint32_t> bufsize)
   {
      std::size_t totalSize = 0;
      char**      p         = environ;
      for (; *p; ++p)
      {
         auto size = std::strlen(*p) + 1;
         if (std::numeric_limits<std::size_t>::max() - size < totalSize)
            return wasi_errno_overflow;
         totalSize += size;
      }
      if (totalSize > 0xffffffffu || p - environ > 0xffffffffu)
         return wasi_errno_overflow;
      *environc = p - environ;
      *bufsize  = totalSize;
      return 0;
   }

   int32_t wasi_environ_get(uint32_t env, uint32_t buf)
   {
      auto pages = state.backend.get_context().current_linear_memory();
      if (pages < 0)
         return wasi_errno_fault;
      std::size_t end = static_cast<std::size_t>(pages) * eosio::vm::page_size;
      if (env > end || buf > end)
         return wasi_errno_fault;
      char* memory = state.backend.get_context().linear_memory();

      for (char** p = ::environ; *p; ++p)
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
         if (::lstat(cPath.c_str(), &stat) < 0)
            return wasi_errno_noent;
      }
      else
      {
         if (::stat(cPath.c_str(), &stat) < 0)
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

   uint32_t wasi_fd_write(wasi_fd_t                fd,
                          span<const wasi_iovec_t> iovs,
                          wasm_ptr<wasi_size_t>    nwritten)
   {
      auto* file = get_file(fd);
      if (!file)
         return wasi_errno_badf;

      *nwritten = 0;

      for (auto iovs_item : iovs)
      {
         char* memory   = state.backend.get_context().linear_memory();
         void* iovs_buf = memory + iovs_item.buf;

         check_bounds(iovs_buf, iovs_item.buf_len);

         if (iovs_item.buf_len && fwrite(iovs_buf, iovs_item.buf_len, 1, file->f) != 1)
         {
            return wasi_errno_io;
         }

         *nwritten += iovs_item.buf_len;
      }

      return 0;
   }

   uint32_t wasi_fd_read(wasi_fd_t fd, span<const wasi_iovec_t> iovs, wasm_ptr<wasi_size_t> nread)
   {
      auto* file = get_file(fd);
      if (!file)
         return wasi_errno_badf;

      *nread = 0;

      for (auto iovs_item : iovs)
      {
         char* memory   = state.backend.get_context().linear_memory();
         void* iovs_buf = memory + iovs_item.buf;

         check_bounds(iovs_buf, iovs_item.buf_len);

         size_t bytes_read = fread(iovs_buf, 1, iovs_item.buf_len, file->f);
         *nread += bytes_read;

         if (bytes_read < iovs_item.buf_len)
            return 0;
      }

      return 0;
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

   uint32_t testerCreateChain(uint64_t hot_bytes,
                              uint64_t warm_bytes,
                              uint64_t cool_bytes,
                              uint64_t cold_bytes)
   {
      state.chains.push_back(std::make_unique<test_chain>(
          state, std::filesystem::temp_directory_path(),
          triedent::database_config{hot_bytes, warm_bytes, cool_bytes, cold_bytes},
          triedent::open_mode::temporary));
      return state.chains.size() - 1;
   }

   uint32_t testerOpenChain(span<const char>                          path,
                            wasi_oflags_t                             oflags,
                            wasi_rights_t                             fs_rights_base,
                            wasm_ptr<const triedent::database_config> config)
   {
      bool read   = fs_rights_base & wasi_rights_fd_read;
      bool write  = fs_rights_base & wasi_rights_fd_write;
      bool create = oflags & wasi_oflags_creat;
      bool excl   = oflags & wasi_oflags_excl;
      bool trunc  = oflags & wasi_oflags_trunc;

      psibase::check(read, "Chain cannot be opened without read access");

      triedent::open_mode mode;
      if (!write)
      {
         if (create || excl || trunc)
            throw std::runtime_error("Unsupported combination of flags for openChain");
         mode = triedent::open_mode::read_only;
      }
      else if (!create && !excl && !trunc)
         mode = triedent::open_mode::read_write;
      else if (create && !excl && !trunc)
         mode = triedent::open_mode::create;
      else if (create && excl && !trunc)
         mode = triedent::open_mode::create_new;
      else if (create && !excl && trunc)
         mode = triedent::open_mode::trunc;
      else
         throw std::runtime_error("Unsupported combination of flags for openChain");

      state.chains.push_back(std::make_unique<test_chain>(
          state, std::string_view{path.data(), path.size()},
          create ? *config : triedent::database_config{1 << 27, 1 << 27, 1 << 27, 1 << 27}, mode));
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

   // TODO: may not be useful anymore; remove?
   void testerShutdownChain(uint32_t chain)
   {
      auto& c = assert_chain(chain);
      c.blockContext.reset();
      c.sys.reset();
      c.db = {};
   }

   void testerStartBlock(uint32_t chain_index, int64_t time_us)
   {
      assert_chain(chain_index)
          .startBlock(time_us ? std::optional{psibase::BlockTime{psibase::MicroSeconds{time_us}}}
                              : std::nullopt);
   }

   void testerFinishBlock(uint32_t chain_index) { assert_chain(chain_index).finishBlock(); }

   uint32_t testerVerify(uint32_t chain_index, span<const char> args_packed)
   {
      auto&              chain = assert_chain(chain_index);
      psio::input_stream s     = {args_packed.data(), args_packed.size()};
      auto               act   = psio::from_frac<psibase::Action>(args_packed);

      BOOST_LOG_SCOPED_THREAD_TAG("TimeStamp", chain.getTimestamp());
      BOOST_LOG_SCOPED_THREAD_TAG("Host", chain.getName());
      psibase::TransactionTrace trace;
      try
      {
         chain.readBlockContext()->execExport("verify", std::move(act), trace);
      }
      catch (const std::exception& e)
      {
         if (!trace.error)
         {
            trace.error = e.what();
         }
      }

      state.result_value = psio::convert_to_frac(trace);
      state.result_key.clear();
      psibase::check(state.result_value.size() <= 0xffff'ffffu, "Transaction trace too large");
      return state.result_value.size();
   }

   uint32_t testerPushTransaction(uint32_t chain_index, span<const char> args_packed)
   {
      auto&              chain     = assert_chain(chain_index);
      psio::input_stream s         = {args_packed.data(), args_packed.size()};
      auto               signedTrx = psio::from_frac<psibase::SignedTransaction>(args_packed);

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

         for (size_t i = 0; i < signedTrx.proofs.size(); ++i)
            proofBC.verifyProof(signedTrx, trace, i, std::nullopt, &*chain.blockContext);

         if (!proofBC.needGenesisAction)
         {
            // checkFirstAuth isn't necessary here, but including it catches
            // the case where an auth service modifies its tables while
            // running in read-only mode.
            //
            // We run the check within blockContext to make it easier for
            // tests to chain transactions which modify auth. There's a
            // cost to this since numExecutionMemories may bounce back
            // and forth.
            auto saveTrace = trace;
            chain.blockContext->checkFirstAuth(signedTrx, trace, std::nullopt,
                                               &*chain.blockContext);
            trace = std::move(saveTrace);
         }

         chain.blockContext->pushTransaction(std::move(signedTrx), trace, std::nullopt);
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
      state.result_value = psio::convert_to_frac(trace);
      state.result_key.clear();
      psibase::check(state.result_value.size() <= 0xffff'ffffu, "Transaction trace too large");
      return state.result_value.size();
   }

   std::int32_t testerHttpRequest(uint32_t chain_index, span<const char> args_packed)
   {
      auto& chain = assert_chain(chain_index);

      auto startTime = std::chrono::steady_clock::now();
      auto req       = psio::view<const psibase::HttpRequest>(args_packed);
      BOOST_LOG_SCOPED_LOGGER_TAG(chain.logger, "RequestMethod", req.method().unpack());
      BOOST_LOG_SCOPED_LOGGER_TAG(chain.logger, "RequestTarget", req.target().unpack());
      BOOST_LOG_SCOPED_LOGGER_TAG(chain.logger, "RequestHost", req.host().unpack());

      BOOST_LOG_SCOPED_THREAD_TAG("TimeStamp", chain.getTimestamp());
      BOOST_LOG_SCOPED_THREAD_TAG("Host", chain.getName());

      psibase::TransactionTrace trace;
      psibase::ActionTrace&     atrace = trace.actionTraces.emplace_back();

      psibase::BlockContext bc{*chain.sys, chain.head, chain.writer, true};
      bc.start();
      psibase::check(!bc.needGenesisAction, "Need genesis block; use 'psibase boot' to boot chain");
      psibase::SignedTransaction  trx;
      psibase::TransactionContext tc{bc, trx, trace, true, false, true};

      std::int32_t fd;

      auto socket = std::make_shared<HttpSocket>();
      chain.sys->sockets->add(socket, &tc.ownedSockets);
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

      auto startExecTime = std::chrono::steady_clock::now();

      try
      {
         auto setStatus = psio::finally(
             [&]
             {
                auto endExecTime = std::chrono::steady_clock::now();

                socket->trace = std::move(trace);

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
         psibase::Action action{
             .sender  = psibase::AccountNumber(),
             .service = psibase::proxyServiceNum,
             .rawData = psio::convert_to_frac(std::tuple(socket->id, req.unpack())),
         };
         tc.execServe(action, atrace);
      }
      catch (...)
      {
      }

      socket->chain = &chain;
      if (!socket->response.empty())
      {
         socket->logResponse();
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

   uint32_t setResult(const std::optional<psio::input_stream>& o)
   {
      state.result_key.clear();
      if (o)
      {
         state.result_value.assign(o->pos, o->end);
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
         state.result_key.assign(o->key.pos, o->key.end);
         state.result_value.assign(o->value.pos, o->value.end);
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
            return {chain, (psibase::DbId)db};
         case uint32_t(psibase::DbId::writeOnly):
         case uint32_t(psibase::DbId::blockLog):
         case uint32_t(psibase::DbId::blockProof):
            return (psibase::DbId)db;
         default:
            throw std::runtime_error("may not write this db, or must use another intrinsic");
      }
   }

   psibase::DbId getDbReadSequential(std::uint32_t db)
   {
      if (db == uint32_t(psibase::DbId::historyEvent))
         return (psibase::DbId)db;
      if (db == uint32_t(psibase::DbId::uiEvent))
         return (psibase::DbId)db;
      if (db == uint32_t(psibase::DbId::merkleEvent))
         return (psibase::DbId)db;
      throw std::runtime_error("may not read this db, or must use another intrinsic");
   }

   uint32_t getResult(eosio::vm::span<char> dest, uint32_t offset)
   {
      if (offset < state.result_value.size() && dest.size())
         memcpy(dest.data(), state.result_value.data() + offset,
                std::min(state.result_value.size() - offset, dest.size()));
      return state.result_value.size();
   }

   uint32_t getKey(eosio::vm::span<char> dest)
   {
      if (!state.result_key.empty())
         memcpy(dest.data(), state.result_key.data(),
                std::min(state.result_key.size(), dest.size()));
      return state.result_key.size();
   }

   uint32_t kvGet(std::uint32_t chain_index, uint32_t db, eosio::vm::span<const char> key)
   {
      auto& chain = assert_chain(chain_index);
      return setResult(
          chain.database().kvGetRaw(getDbRead(chain, db).db, {key.data(), key.size()}));
   }

   uint32_t getSequential(std::uint32_t chain_index, uint32_t db, uint64_t indexNumber)
   {
      return setResult(database(chain_index)
                           .kvGetRaw(getDbReadSequential(db), psio::convert_to_key(indexNumber)));
   }

   uint32_t kvGreaterEqual(std::uint32_t               chain_index,
                           uint32_t                    db,
                           eosio::vm::span<const char> key,
                           uint32_t                    matchKeySize)
   {
      psibase::check(matchKeySize <= key.size(), "matchKeySize is larger than key");
      auto& chain = assert_chain(chain_index);
      return setResult(chain.database().kvGreaterEqualRaw(getDbRead(chain, db).db,
                                                          {key.data(), key.size()}, matchKeySize));
   }

   uint32_t kvLessThan(std::uint32_t               chain_index,
                       uint32_t                    db,
                       eosio::vm::span<const char> key,
                       uint32_t                    matchKeySize)
   {
      psibase::check(matchKeySize <= key.size(), "matchKeySize is larger than key");
      auto& chain = assert_chain(chain_index);
      return setResult(chain.database().kvLessThanRaw(getDbRead(chain, db).db,
                                                      {key.data(), key.size()}, matchKeySize));
   }

   uint32_t kvMax(std::uint32_t chain_index, uint32_t db, eosio::vm::span<const char> key)
   {
      auto& chain = assert_chain(chain_index);
      return setResult(
          chain.database().kvMaxRaw(getDbRead(chain, db).db, {key.data(), key.size()}));
   }

   void kvPut(std::uint32_t               chain_index,
              uint32_t                    db,
              eosio::vm::span<const char> key,
              eosio::vm::span<const char> value)
   {
      auto& chain = assert_chain(chain_index);
      state.result_key.clear();
      state.result_value.clear();
      chain.database().kvPutRaw(getDbWrite(chain, db).db, {key.data(), key.size()},
                                {value.data(), value.size()});
   }

   void kvRemove(std::uint32_t chain_index, uint32_t db, eosio::vm::span<const char> key)
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

void register_callbacks()
{
   // Psibase Intrinsics
   rhf_t::add<&callbacks::abortMessage>("psibase", "abortMessage");
   rhf_t::add<&callbacks::getResult>("psibase", "getResult");
   rhf_t::add<&callbacks::getKey>("psibase", "getKey");
   rhf_t::add<&callbacks::kvGet>("psibase", "kvGet");
   rhf_t::add<&callbacks::getSequential>("psibase", "getSequential");
   rhf_t::add<&callbacks::kvGreaterEqual>("psibase", "kvGreaterEqual");
   rhf_t::add<&callbacks::kvLessThan>("psibase", "kvLessThan");
   rhf_t::add<&callbacks::kvMax>("psibase", "kvMax");
   rhf_t::add<&callbacks::kvPut>("psibase", "kvPut");
   rhf_t::add<&callbacks::kvRemove>("psibase", "kvRemove");
   rhf_t::add<&callbacks::kvGetTransactionUsage>("psibase", "kvGetTransactionUsage");

   // Tester Intrinsics
   rhf_t::add<&callbacks::testerCreateChain>("psibase", "createChain");
   rhf_t::add<&callbacks::testerOpenChain>("psibase", "openChain");
   rhf_t::add<&callbacks::testerCloneChain>("psibase", "cloneChain");
   rhf_t::add<&callbacks::testerGetFork>("psibase", "getFork");
   rhf_t::add<&callbacks::testerDestroyChain>("psibase", "destroyChain");
   rhf_t::add<&callbacks::testerShutdownChain>("psibase", "shutdownChain");
   rhf_t::add<&callbacks::testerStartBlock>("psibase", "startBlock");
   rhf_t::add<&callbacks::testerFinishBlock>("psibase", "finishBlock");
   rhf_t::add<&callbacks::checkoutSubjective>("psibase", "checkoutSubjective");
   rhf_t::add<&callbacks::commitSubjective>("psibase", "commitSubjective");
   rhf_t::add<&callbacks::abortSubjective>("psibase", "abortSubjective");
   rhf_t::add<&callbacks::commitState>("psibase", "commitState");
   rhf_t::add<&callbacks::testerVerify>("psibase", "verify");
   rhf_t::add<&callbacks::testerPushTransaction>("psibase", "pushTransaction");
   rhf_t::add<&callbacks::testerHttpRequest>("psibase", "httpRequest");
   rhf_t::add<&callbacks::testerSocketRecv>("psibase", "socketRecv");
   rhf_t::add<&callbacks::testerExecute>("env", "testerExecute");

   // WASI functions
   rhf_t::add<&callbacks::wasi_args_get>("wasi_snapshot_preview1", "args_get");
   rhf_t::add<&callbacks::wasi_args_sizes_get>("wasi_snapshot_preview1", "args_sizes_get");
   rhf_t::add<&callbacks::wasi_clock_time_get>("wasi_snapshot_preview1", "clock_time_get");
   rhf_t::add<&callbacks::wasi_environ_get>("wasi_snapshot_preview1", "environ_get");
   rhf_t::add<&callbacks::wasi_environ_sizes_get>("wasi_snapshot_preview1", "environ_sizes_get");
   rhf_t::add<&callbacks::wasi_fd_close>("wasi_snapshot_preview1", "fd_close");
   rhf_t::add<&callbacks::wasi_fd_fdstat_get>("wasi_snapshot_preview1", "fd_fdstat_get");
   rhf_t::add<&callbacks::wasi_fd_fdstat_set_flags>("wasi_snapshot_preview1",
                                                    "fd_fdstat_set_flags");
   rhf_t::add<&callbacks::wasi_fd_filestat_get>("wasi_snapshot_preview1", "fd_filestat_get");
   rhf_t::add<&callbacks::wasi_fd_prestat_dir_name>("wasi_snapshot_preview1",
                                                    "fd_prestat_dir_name");
   rhf_t::add<&callbacks::wasi_fd_prestat_get>("wasi_snapshot_preview1", "fd_prestat_get");
   rhf_t::add<&callbacks::wasi_fd_read>("wasi_snapshot_preview1", "fd_read");
   rhf_t::add<&callbacks::wasi_fd_readdir>("wasi_snapshot_preview1", "fd_readdir");
   rhf_t::add<&callbacks::wasi_fd_seek>("wasi_snapshot_preview1", "fd_seek");
   rhf_t::add<&callbacks::wasi_fd_write>("wasi_snapshot_preview1", "fd_write");
   rhf_t::add<&callbacks::wasi_path_filestat_get>("wasi_snapshot_preview1", "path_filestat_get");
   rhf_t::add<&callbacks::wasi_path_open>("wasi_snapshot_preview1", "path_open");
   rhf_t::add<&callbacks::wasi_proc_exit>("wasi_snapshot_preview1", "proc_exit");
   rhf_t::add<&callbacks::wasi_random_get>("wasi_snapshot_preview1", "random_get");
   rhf_t::add<&callbacks::wasi_sched_yield>("wasi_snapshot_preview1", "sched_yield");
}

void fill_substitutions(::state& state, const std::map<std::string, std::string>& substitutions)
{
   for (auto& [a, b] : substitutions)
   {
      std::vector<uint8_t> acode;
      std::vector<uint8_t> bcode;
      try
      {
         acode = eosio::vm::read_wasm(a);
      }
      catch (...)
      {
         std::cerr << "skipping substitution: can not read " << a << "\n";
         continue;
      }
      try
      {
         bcode = eosio::vm::read_wasm(b);
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

static void run(const char*                               wasm,
                const std::vector<std::string>&           args,
                const std::map<std::string, std::string>& substitutions,
                const cl_flags_t&                         additional_args)
{
   eosio::vm::wasm_allocator wa;
   auto                      code = eosio::vm::read_wasm(wasm);
   backend_t                 backend(code, nullptr);
   psio::input_stream        s{(const char*)code.data(), code.size()};
   //
   auto dwarf_info = dwarf::get_info_from_wasm(s);
   auto reg        = debug_eos_vm::enable_debug(code, backend, dwarf_info, s);

   ::state state{wasm, dwarf_info, wa, backend, args, additional_args};
   fill_substitutions(state, substitutions);
   callbacks cb{state};
   state.files.emplace_back(stdin, false);
   state.files.emplace_back(stdout, false);
   state.files.emplace_back(stderr, false);
   state.files.emplace_back();  // reserve space for fd 3: root dir
   backend.set_wasm_allocator(&wa);

   rhf_t::resolve(backend.get_module());
   backend.initialize(&cb);
   backend(cb, "env", "_start");
}

struct ConsoleLog
{
   std::string type   = "console";
   std::string filter = "Severity > critical";
   std::string format =
       "[{TimeStamp}] [{Severity}] [{Host}]: {Message}{?: {TransactionId}}{?: {BlockId}: "
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
)";

int main(int argc, char* argv[])
{
   // Must run before any additional threads are started
   {
      auto prefix = psibase::installPrefix();
      ::setenv("PSIBASE_DATADIR", (prefix / "share" / "psibase").c_str(), 1);
   }
   bool                               show_usage   = false;
   bool                               error        = false;
   bool                               show_version = false;
   int                                verbose      = 0;
   Loggers                            logConfig;
   std::map<std::string, std::string> substitutions;
   cl_flags_t                         additional_args;

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
   if (next_arg >= argc)
      error = true;
   if (show_version)
   {
      std::cerr << "psitest " << PSIBASE_VERSION_MAJOR << "." << PSIBASE_VERSION_MINOR << "."
                << PSIBASE_VERSION_PATCH << "\n";
      return 0;
   }
   if (show_usage || error)
   {
      std::cerr << usage;
      if (show_usage)
         std::cerr << help;
      return error;
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
      psibase::loggers::configure(
          psio::convert_from_json<psibase::loggers::Config>(psio::convert_to_json(logConfig)));
      std::vector<std::string> args{argv + next_arg, argv + argc};
      psibase::ExecutionContext::registerHostFunctions();
      register_callbacks();
      run(argv[next_arg], args, substitutions, additional_args);
      return 0;
   }
   catch (::assert_exception& e)
   {
      std::cerr << "tester wasm asserted: " << e.what() << "\n";
   }
   catch (eosio::vm::exception& e)
   {
      std::cerr << "vm::exception: " << e.detail() << "\n";
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
