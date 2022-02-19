#include <debug_eos_vm/debug_eos_vm.hpp>
#include <eosio/chain_types.hpp>
#include <eosio/fixed_bytes.hpp>
#include <eosio/to_bin.hpp>
#include <fc/filesystem.hpp>
#include <newchain/block_context.hpp>

#include <stdio.h>
#include <chrono>
#include <optional>

using namespace std::literals;

using eosio::convert_to_bin;
using eosio::vm::span;

struct callbacks;
using rhf_t = eosio::vm::registered_host_functions<callbacks>;

void backtrace();

struct vm_options
{
   static constexpr std::uint32_t max_call_depth = 1024;
};

template <>
void eosio::vm::machine_code_writer<
    eosio::vm::jit_execution_context<callbacks, true>>::on_unreachable()
{
   backtrace();
   eosio::vm::throw_<wasm_interpreter_exception>("unreachable");
}

DEBUG_PARSE_CODE_SECTION(rhf_t, vm_options)
using backend_t = eosio::vm::backend<  //
    rhf_t,
    eosio::vm::jit_profile,
    vm_options,
    debug_eos_vm::debug_instr_map>;

inline constexpr int max_backtrace_frames = 512;

inline constexpr int      block_interval_ms   = 500;
inline constexpr int      block_interval_us   = block_interval_ms * 1000;
inline constexpr uint32_t billed_cpu_time_use = 2000;

inline constexpr int32_t polyfill_root_dir_fd = 3;

inline constexpr uint16_t wasi_errno_badf  = 8;
inline constexpr uint16_t wasi_errno_inval = 28;
inline constexpr uint16_t wasi_errno_io    = 29;
inline constexpr uint16_t wasi_errno_noent = 44;

inline constexpr uint8_t wasi_filetype_character_device = 2;
inline constexpr uint8_t wasi_filetype_directory        = 3;
inline constexpr uint8_t wasi_filetype_regular_file     = 4;

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

struct assert_exception : std::exception
{
   std::string msg;

   assert_exception(std::string&& msg) : msg(std::move(msg)) {}

   const char* what() const noexcept override { return msg.c_str(); }
};

struct file;
struct test_chain;

struct state
{
   const char*                              wasm;
   dwarf::info&                             dwarf_info;
   eosio::vm::wasm_allocator&               wa;
   backend_t&                               backend;
   std::vector<std::string>                 args;
   std::vector<file>                        files;
   std::vector<std::unique_ptr<test_chain>> chains;
   std::optional<uint32_t>                  selected_chain_index;
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
   ::state&                                  state;
   std::set<test_chain_ref*>                 refs;
   fc::temp_directory                        dir;
   std::unique_ptr<newchain::database>       db;
   std::unique_ptr<newchain::system_context> sys;
   std::unique_ptr<newchain::block_context>  block;

   test_chain(::state& state, const std::string& snapshot, uint64_t state_size) : state{state}
   {
      eosio::check(snapshot.empty(), "snapshots not implemented");
      db  = std::make_unique<newchain::database>(dir.path(), chainbase::database::read_write,
                                                state_size);
      sys = std::make_unique<newchain::system_context>(newchain::system_context{*db});
   }

   test_chain(const test_chain&) = delete;
   test_chain& operator=(const test_chain&) = delete;

   ~test_chain()
   {
      for (auto* ref : refs)
         ref->chain = nullptr;
   }

   void start_block(int64_t skip_miliseconds = 0)
   {
      // TODO: time control
      // TODO: undo control
      finish_block();
      block = std::make_unique<newchain::block_context>(*sys, true);
      block->start();
   }

   void start_if_needed()
   {
      if (!block)
         start_block();
   }

   void finish_block()
   {
      if (block)
      {
         block->commit();
         block.reset();
      }
   }
};  // test_chain

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

struct push_trx_args
{
   eosio::input_stream             transaction;
   std::vector<eosio::signature>   signatures;
   std::vector<eosio::private_key> keys;
};
EOSIO_REFLECT(push_trx_args, transaction, signatures, keys)

struct callbacks
{
   ::state&          state;
   static callbacks* single;  // TODO: remove

   callbacks(::state& state) : state{state} { single = this; }
   ~callbacks() { single = nullptr; }

   void backtrace()
   {
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

   char* alloc(uint32_t cb_alloc_data, uint32_t cb_alloc, uint32_t size)
   {
      // todo: verify cb_alloc isn't in imports
      if (state.backend.get_module().tables.size() < 0 ||
          state.backend.get_module().tables[0].table.size() < cb_alloc)
      {
         backtrace();
         throw std::runtime_error("cb_alloc is out of range");
      }
      // Note from Steven: eos-vm not saving top_frame and bottom_frame is an eos-vm bug. The
      // backtrace was originally designed for profiling contracts, where reentering wasm is not
      // possible. In addition, saving and restoring these variables is very tricky to do correctly
      // in the face of asynchronous interrupts, so I didn't bother.
      auto top_frame                            = state.backend.get_context()._top_frame;
      auto bottom_frame                         = state.backend.get_context()._bottom_frame;
      auto result                               = state.backend.get_context().execute(  //
          this, eosio::vm::jit_visitor(42), state.backend.get_module().tables[0].table[cb_alloc],
          cb_alloc_data, size);
      state.backend.get_context()._top_frame    = top_frame;
      state.backend.get_context()._bottom_frame = bottom_frame;
      if (!result || !result->is_a<eosio::vm::i32_const_t>())
      {
         backtrace();
         throw std::runtime_error("cb_alloc returned incorrect type");
      }
      char* begin = state.wa.get_base_ptr<char>() + result->to_ui32();
      check_bounds(begin, size);
      return begin;
   }

   template <typename T>
   void set_data(uint32_t cb_alloc_data, uint32_t cb_alloc, const T& data)
   {
      memcpy(alloc(cb_alloc_data, cb_alloc, data.size()), data.data(), data.size());
   }

   void tester_abort()
   {
      backtrace();
      throw std::runtime_error("called tester_abort");
   }

   void eosio_exit(int32_t)
   {
      backtrace();
      throw std::runtime_error("called eosio_exit");
   }

   void abort_message(span<const char> msg)
   {
      backtrace();
      throw ::assert_exception(span_str(msg));
   }

   void eosio_assert_message(bool condition, span<const char> msg)
   {
      if (!condition)
         abort_message(msg);
   }

   void prints_l(span<const char> str) { std::cout.write(str.data(), str.size()); }

   void tester_get_arg_counts(wasm_ptr<uint32_t> argc, wasm_ptr<uint32_t> argv_buf_size)
   {
      uint32_t size = 0;
      for (auto& a : state.args)
         size += a.size() + 1;
      *argc          = state.args.size();
      *argv_buf_size = size;
   };

   // uint8_t** argv, uint8_t* argv_buf
   void tester_get_args(uint32_t argv, uint32_t argv_buf)
   {
      auto* memory   = state.backend.get_context().linear_memory();
      auto  get_argv = [&]() -> uint32_t& { return *reinterpret_cast<uint32_t*>(memory + argv); };
      auto  get_argv_buf = [&]() -> uint8_t& {
         return *reinterpret_cast<uint8_t*>(memory + argv_buf);
      };

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
   };

   int32_t tester_clock_time_get(uint32_t id, uint64_t precision, wasm_ptr<uint64_t> time)
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

   uint32_t tester_fdstat_get(int32_t            fd,
                              wasm_ptr<uint8_t>  fs_filetype,
                              wasm_ptr<uint16_t> fs_flags,
                              wasm_ptr<uint64_t> fs_rights_base,
                              wasm_ptr<uint64_t> fs_rights_inheriting)
   {
      if (fd == STDIN_FILENO)
      {
         *fs_filetype          = wasi_filetype_character_device;
         *fs_flags             = 0;
         *fs_rights_base       = wasi_rights_fd_read;
         *fs_rights_inheriting = 0;
         return 0;
      }
      if (fd == STDOUT_FILENO || fd == STDERR_FILENO)
      {
         *fs_filetype          = wasi_filetype_character_device;
         *fs_flags             = wasi_fdflags_append;
         *fs_rights_base       = wasi_rights_fd_write;
         *fs_rights_inheriting = 0;
         return 0;
      }
      if (fd == polyfill_root_dir_fd)
      {
         *fs_filetype          = wasi_filetype_directory;
         *fs_flags             = 0;
         *fs_rights_base       = 0;
         *fs_rights_inheriting = wasi_rights_fd_read | wasi_rights_fd_write;
         return 0;
      }
      if (get_file(fd))
      {
         *fs_filetype          = wasi_filetype_regular_file;
         *fs_flags             = 0;
         *fs_rights_base       = wasi_rights_fd_read | wasi_rights_fd_write;
         *fs_rights_inheriting = 0;
         return 0;
      }
      return wasi_errno_badf;
   }

   uint32_t tester_open_file(span<const char>  path,
                             uint32_t          oflags,
                             uint64_t          fs_rights_base,
                             uint32_t          fdflags,
                             wasm_ptr<int32_t> opened_fd)
   {
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

      file f = fopen(span_str(path).c_str(), mode);
      if (!f.f)
         return wasi_errno_noent;
      state.files.push_back(std::move(f));
      *opened_fd = state.files.size() - 1;
      return 0;
   }

   uint32_t tester_close_file(int32_t fd)
   {
      auto* file = get_file(fd);
      if (!file)
         return wasi_errno_badf;
      file->close();
      return 0;
   }

   uint32_t tester_write_file(int32_t fd, span<const char> content)
   {
      auto* file = get_file(fd);
      if (!file)
         return wasi_errno_badf;
      if (!content.size() || fwrite(content.data(), content.size(), 1, file->f) == 1)
         return 0;
      return wasi_errno_io;
   }

   uint32_t tester_read_file(int32_t fd, span<char> content, wasm_ptr<int32_t> result)
   {
      auto* file = get_file(fd);
      if (!file)
         return wasi_errno_badf;
      *result = fread(content.data(), 1, content.size(), file->f);
      return 0;
   }

   bool tester_read_whole_file(span<const char> filename, uint32_t cb_alloc_data, uint32_t cb_alloc)
   {
      file f = fopen(span_str(filename).c_str(), "r");
      if (!f.f)
         return false;
      if (fseek(f.f, 0, SEEK_END))
         return false;
      auto size = ftell(f.f);
      if (size < 0 || (long)(uint32_t)size != size)
         return false;
      if (fseek(f.f, 0, SEEK_SET))
         return false;
      std::vector<char> buf(size);
      if (fread(buf.data(), size, 1, f.f) != 1)
         return false;
      set_data(cb_alloc_data, cb_alloc, buf);
      return true;
   }

   int32_t tester_execute(span<const char> command) { return system(span_str(command).c_str()); }

   test_chain& assert_chain(uint32_t chain, bool require_context = true)
   {
      if (chain >= state.chains.size() || !state.chains[chain])
         throw std::runtime_error("chain does not exist or was destroyed");
      auto& result = *state.chains[chain];
      if (require_context && !result.sys)
         throw std::runtime_error("chain was shut down");
      return result;
   }

   uint32_t tester_create_chain(span<const char> snapshot, uint64_t state_size)
   {
      state.chains.push_back(std::make_unique<test_chain>(state, span_str(snapshot), state_size));
      if (state.chains.size() == 1)
         state.selected_chain_index = 0;
      return state.chains.size() - 1;
   }

   void tester_destroy_chain(uint32_t chain)
   {
      assert_chain(chain, false);
      if (state.selected_chain_index && *state.selected_chain_index == chain)
         state.selected_chain_index.reset();
      state.chains[chain].reset();
      while (!state.chains.empty() && !state.chains.back())
      {
         state.chains.pop_back();
      }
   }

   void tester_shutdown_chain(uint32_t chain)
   {
      auto& c = assert_chain(chain);
      c.block.reset();
      c.sys.reset();
      c.db.reset();
   }

   uint32_t tester_get_chain_path(uint32_t chain, span<char> dest)
   {
      auto& c = assert_chain(chain, false);
      auto  s = c.dir.path().string();
      memcpy(dest.data(), s.c_str(), std::min(dest.size(), s.size()));
      return s.size();
   }

   void tester_start_block(uint32_t chain_index, int64_t skip_miliseconds)
   {
      assert_chain(chain_index).start_block(skip_miliseconds);
   }

   void tester_finish_block(uint32_t chain_index) { assert_chain(chain_index).finish_block(); }

   void tester_get_head_block_info(uint32_t chain_index, uint32_t cb_alloc_data, uint32_t cb_alloc)
   {
      auto&                chain = assert_chain(chain_index);
      newchain::block_info bi;
      auto*                obj = chain.db->db.find<newchain::status_object>();
      if (obj && obj->head)
         bi = *obj->head;
      set_data(cb_alloc_data, cb_alloc, convert_to_bin(bi));
   }

   void tester_push_transaction(uint32_t         chain_index,
                                span<const char> args_packed,
                                uint32_t         cb_alloc_data,
                                uint32_t         cb_alloc)
   {
      auto&               chain = assert_chain(chain_index);
      eosio::input_stream s     = {args_packed.data(), args_packed.size()};
      auto                args  = eosio::from_bin<push_trx_args>(s);
      auto                trx   = eosio::from_bin<newchain::transaction>(args.transaction);

      newchain::signed_transaction signed_trx;
      (newchain::transaction&)signed_trx = std::move(trx);
      signed_trx.signatures              = std::move(args.signatures);

      // TODO: sign with args.keys

      chain.start_if_needed();
      newchain::transaction_trace trace;
      auto                        start_time = std::chrono::steady_clock::now();
      try
      {
         // TODO: undo and commit control
         chain.block->push_transaction(signed_trx, trace);
      }
      catch (const std::exception& e)
      {
      }

      auto us = std::chrono::duration_cast<std::chrono::microseconds>(
          std::chrono::steady_clock::now() - start_time);
      std::cout << "newchain transaction took " << us.count() << " us\n";
      // std::cout << eosio::format_json(trace) << "\n";
      set_data(cb_alloc_data, cb_alloc, convert_to_bin(trace));
   }

   void tester_select_chain_for_db(uint32_t chain_index)
   {
      assert_chain(chain_index);
      state.selected_chain_index = chain_index;
   }
};  // callbacks

callbacks* callbacks::single = nullptr;  // TODO: remove

void backtrace()
{
   if (callbacks::single)
      callbacks::single->backtrace();
}

#define DB_REGISTER_SECONDARY(IDX)                                                         \
   rhf_t::add<&callbacks::db_##IDX##_find_secondary>("env", "db_" #IDX "_find_secondary"); \
   rhf_t::add<&callbacks::db_##IDX##_find_primary>("env", "db_" #IDX "_find_primary");     \
   rhf_t::add<&callbacks::db_##IDX##_lowerbound>("env", "db_" #IDX "_lowerbound");         \
   rhf_t::add<&callbacks::db_##IDX##_upperbound>("env", "db_" #IDX "_upperbound");         \
   rhf_t::add<&callbacks::db_##IDX##_end>("env", "db_" #IDX "_end");                       \
   rhf_t::add<&callbacks::db_##IDX##_next>("env", "db_" #IDX "_next");                     \
   rhf_t::add<&callbacks::db_##IDX##_previous>("env", "db_" #IDX "_previous");

void register_callbacks()
{
   rhf_t::add<&callbacks::tester_abort>("env", "tester_abort");
   rhf_t::add<&callbacks::eosio_exit>("env", "eosio_exit");
   rhf_t::add<&callbacks::abort_message>("env", "abort_message");
   rhf_t::add<&callbacks::eosio_assert_message>("env", "eosio_assert_message");
   rhf_t::add<&callbacks::prints_l>("env", "prints_l");
   rhf_t::add<&callbacks::tester_get_arg_counts>("env", "tester_get_arg_counts");
   rhf_t::add<&callbacks::tester_get_args>("env", "tester_get_args");
   rhf_t::add<&callbacks::tester_clock_time_get>("env", "tester_clock_time_get");
   rhf_t::add<&callbacks::tester_fdstat_get>("env", "tester_fdstat_get");
   rhf_t::add<&callbacks::tester_open_file>("env", "tester_open_file");
   rhf_t::add<&callbacks::tester_close_file>("env", "tester_close_file");
   rhf_t::add<&callbacks::tester_write_file>("env", "tester_write_file");
   rhf_t::add<&callbacks::tester_read_file>("env", "tester_read_file");
   rhf_t::add<&callbacks::tester_read_whole_file>("env", "tester_read_whole_file");
   rhf_t::add<&callbacks::tester_execute>("env", "tester_execute");
   rhf_t::add<&callbacks::tester_create_chain>("env", "tester_create_chain");
   rhf_t::add<&callbacks::tester_destroy_chain>("env", "tester_destroy_chain");
   rhf_t::add<&callbacks::tester_shutdown_chain>("env", "tester_shutdown_chain");
   rhf_t::add<&callbacks::tester_get_chain_path>("env", "tester_get_chain_path");
   rhf_t::add<&callbacks::tester_start_block>("env", "tester_start_block");
   rhf_t::add<&callbacks::tester_finish_block>("env", "tester_finish_block");
   rhf_t::add<&callbacks::tester_get_head_block_info>("env", "tester_get_head_block_info");
   rhf_t::add<&callbacks::tester_push_transaction>("env", "tester_push_transaction");
   rhf_t::add<&callbacks::tester_select_chain_for_db>("env", "tester_select_chain_for_db");
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
                const std::map<std::string, std::string>& substitutions)
{
   eosio::vm::wasm_allocator wa;
   auto                      code = eosio::vm::read_wasm(wasm);
   backend_t                 backend(code, nullptr);
   auto dwarf_info = dwarf::get_info_from_wasm({(const char*)code.data(), code.size()});
   auto reg        = debug_eos_vm::enable_debug(code, backend, dwarf_info, "_start");

   ::state state{wasm, dwarf_info, wa, backend, args};
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

const char usage[] = "USAGE: cltester [OPTIONS] file.wasm [args for wasm]...\n";
const char help[]  = R"(
OPTIONS:
      -h, --help

            Show this message

      -v, --verbose

            Show detailed logging

      -s contract.wasm debug.wasm
      --subst contract.wasm debug.wasm

            Whenever contract.wasm needs to run, substitute debug.wasm in its
            place and enable debugging support. This bypasses size limits and
            other constraints on debug.wasm. eosiolib still enforces
            constraints on contract.wasm. (repeatable)
)";

int main(int argc, char* argv[])
{
   bool                               show_usage = false;
   bool                               error      = false;
   std::map<std::string, std::string> substitutions;
   int                                next_arg = 1;
   while (next_arg < argc && argv[next_arg][0] == '-')
   {
      if (!strcmp(argv[next_arg], "-h") || !strcmp(argv[next_arg], "--help"))
         show_usage = true;
      else if (!strcmp(argv[next_arg], "-v") || !strcmp(argv[next_arg], "--verbose"))
      {
         // TODO
      }
      else if (!strcmp(argv[next_arg], "-s") || !strcmp(argv[next_arg], "--subst"))
      {
         next_arg += 2;
         if (next_arg >= argc)
         {
            std::cerr << argv[next_arg - 2] << " needs 2 args\n";
            error = true;
         }
         else
         {
            substitutions[argv[next_arg - 1]] = argv[next_arg];
         }
      }
      else
      {
         std::cerr << "unknown option: " << argv[next_arg] << "\n";
         error = true;
      }
      ++next_arg;
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
   try
   {
      std::vector<std::string> args{argv + next_arg, argv + argc};
      newchain::execution_context::register_host_functions();
      register_callbacks();
      run(argv[next_arg], args, substitutions);
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
   catch (std::exception& e)
   {
      std::cerr << "std::exception: " << e.what() << "\n";
   }
   return 1;
}
