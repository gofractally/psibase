#include <algorithm>
#include <atomic>
#include <bit>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <catch2/catch_all.hpp>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <functional>
#include <psibase/PsizamPolicy.hpp>
#include <psibase/NativeAotCache.hpp>
#include <psibase/NativeFunctions.hpp>
#include <psibase/NativeHostFunctions.hpp>
#include <psibase/ActionContext.hpp>
#include <psibase/TransactionContext.hpp>
#include <psibase/Watchdog.hpp>
#include <psibase/serviceEntry.hpp>
#include <psibase/finally.hpp>
#include <psio/pssz.hpp>
#include <psio/pssz_view.hpp>
#include <psibase/VmEngine.hpp>
#include <psibase/NativeVM.hpp>
#include <psizam/debug/debug.hpp>
#include <thread>
#include "TempDirectory.hpp"

namespace
{
   struct TrackedHostFailure : std::runtime_error
   {
      std::shared_ptr<int> payload;
      explicit TrackedHostFailure(std::shared_ptr<int> value)
          : std::runtime_error("host exception"), payload(std::move(value))
      {
      }
   };

   struct Host
   {
      unsigned                                  spans      = 0;
      unsigned                                  writes     = 0;
      unsigned                                  destructed = 0;
      std::string                               seen;
      std::function<std::int32_t(std::int32_t)> nested;
      std::weak_ptr<int> failurePayload;
      std::uint64_t span(std::span<const char> value, std::uint32_t salt)
      {
         ++spans;
         if (!value.empty())
            seen.assign(value.data(), value.size());
         return value.size() + salt;
      }
      void write(psizam::detail::argument_proxy<std::uint64_t*> value)
      {
         ++writes;
         *value = 0x1122334455667788ull;
      }
      std::int32_t call(std::int32_t value) { return nested(value); }
      void         fail()
      {
         auto cleanup = psibase::finally{[&] { ++destructed; }};
         auto payload = std::make_shared<int>(1);
         failurePayload = payload;
         throw TrackedHostFailure(std::move(payload));
      }
      double nan() { return std::bit_cast<double>(0x7ff0000000000001ull); }
   };
   using Functions = psizam::registered_host_functions<Host>;
   using Backend   = psizam::backend<Functions,
                                     psibase::NativeVM,
                                     psibase::NativeVMOptions,
                                     psizam::debug::debug_instr_map>;

   struct Runtime
   {
      psibase::NativeVMOptions      options;
      psizam::wasm_allocator        memory;
      psizam::wasm_code             code;
      Backend                       backend;
      Host                          host;
      psizam::detail::stack_manager stack;

      static psizam::wasm_code load(const psibase::NativeVMOptions& options)
      {
         static const bool registered = []
         {
            Functions::add<&Host::span>("env", "span");
            Functions::add<&Host::write>("env", "write");
            Functions::add<&Host::call>("env", "nested");
            Functions::add<&Host::fail>("env", "throw");
            Functions::add<&Host::nan>("env", "nan");
            return true;
         }();
         (void)registered;
         auto result = psizam::read_wasm(PSIBASE_PSIZAM_POLICY_WASM);
         psibase::validateNativeWasm(result, options);
         return result;
      }
      explicit Runtime(psibase::VMOptions values = {})
          : options(values), code(load(options)), backend(code, nullptr, options)
      {
         backend.set_wasm_allocator(&memory);
         backend.initialize(stack, &host);
      }
      auto run(std::string_view function)
      {
         return backend.get_context().template execute<psizam::type_converter<Host>>(
             stack, &host, psizam::detail::jit_visitor{backend.get_context()},
             backend.get_module().get_exported_function(function));
      }
      std::uint64_t integer(std::string_view name)
      {
         auto result = run(name);
         REQUIRE(result.has_value());
         if (result->template is_a<psizam::detail::i32_const_t>())
            return result->to_ui32();
         REQUIRE(result->template is_a<psizam::detail::i64_const_t>());
         return result->to_ui64();
      }
   };
}  // namespace

TEST_CASE("Native psizam policy forwards every serialized VM option")
{
   psibase::VMOptions       chain{4321, 2, 3, 32768};
   psibase::NativeVMOptions options(chain);
   CHECK(psio::to_pssz(static_cast<const psibase::VMOptions&>(options)) == psio::to_pssz(chain));
   CHECK(options.max_mutable_global_bytes == 4321);
   CHECK(options.max_pages == 2);
   CHECK(options.max_table_elements == 3);
   CHECK(options.max_stack_bytes == 32768);
   STATIC_REQUIRE(!psibase::NativeVMOptions::gas_metering);
   STATIC_REQUIRE(psibase::NativeVMOptions::fp == psizam::fp_mode::softfloat);
   STATIC_REQUIRE(psibase::NativeVMOptions::memory_mode == psizam::mem_safety::guarded);
   chain.max_pages = 65537;
   CHECK_THROWS(psibase::NativeVMOptions(chain));
   chain.max_pages       = 1;
   chain.max_stack_bytes = 0xffffffffu;
   CHECK_THROWS(psibase::NativeVMOptions(chain));
}

TEST_CASE("Native declaration preflight rejects unsupported resource and import models")
{
   const std::vector<std::vector<std::uint8_t>> invalid = {
       {5, 3, 2, 0, 0},                   // two memories
       {5, 4, 1, 3, 1, 2},                // shared memory
       {5, 3, 1, 4, 1},                   // memory64
       {4, 4, 1, 0x6f, 0, 0},             // externref table
       {2, 7, 1, 0, 0, 2, 0, 1, 0},       // imported memory
       {13, 1, 0},                        // exception tags
       {5, 0xff, 0xff, 0xff, 0xff, 0x10}  // overflowing section length
   };
   for (const auto& suffix : invalid)
   {
      std::vector<std::uint8_t> code{0, 'a', 's', 'm', 1, 0, 0, 0};
      code.insert(code.end(), suffix.begin(), suffix.end());
      CHECK_THROWS(psibase::validateNativeWasm(code, psibase::NativeVMOptions({})));
   }
}

namespace
{
   struct AllowedProposals : psibase::NativeVMOptions
   {
      static constexpr bool enable_atomics = true;
      static constexpr bool enable_relaxed_simd = true;
      static constexpr bool enable_tail_calls = true;
      AllowedProposals() : NativeVMOptions({}) {}
   };
}

TEST_CASE("Native engines share the explicit supported proposal profile")
{
   // A valid () -> () function, with no imports or exported host ABI.
   auto make = [](std::vector<uint8_t> instructions)
   {
      std::vector<uint8_t> body{0};  // zero local declarations
      body.insert(body.end(), instructions.begin(), instructions.end());
      body.push_back(0x0b);
      REQUIRE(body.size() < 126);
      psizam::wasm_code code{0, 'a', 's', 'm', 1, 0, 0, 0,
                             1, 4, 1, 0x60, 0, 0, 3, 2, 1, 0,
                             10, static_cast<uint8_t>(body.size() + 2), 1,
                             static_cast<uint8_t>(body.size())};
      code.insert(code.end(), body.begin(), body.end());
      return code;
   };
   std::vector<std::vector<uint8_t>> functions{
       {0xfe, 3, 0},  // atomic.fence
       {0x12, 0}      // return_call to the valid () -> () self function
   };
   std::vector<uint8_t> swizzle;
   for (int i = 0; i < 2; ++i)
   {
      swizzle.insert(swizzle.end(), {0xfd, 0x0c});  // v128.const
      swizzle.insert(swizzle.end(), 16, 0);
   }
   swizzle.insert(swizzle.end(), {0xfd, 0x80, 2, 0x1a});  // relaxed_swizzle; drop
   functions.push_back(std::move(swizzle));
   const std::array enabled{psibase::NativeVMOptions::enable_atomics,
                            psibase::NativeVMOptions::enable_tail_calls,
                            psibase::NativeVMOptions::enable_relaxed_simd};
   for (size_t i = 0; i < functions.size(); ++i)
   {
      auto code = make(functions[i]);
      using Validator = psizam::backend<std::nullptr_t, psizam::null_backend, AllowedProposals>;
      REQUIRE_NOTHROW(Validator(code, nullptr, AllowedProposals{}));
      if (enabled[i])
         CHECK_NOTHROW(Backend(code, nullptr, psibase::NativeVMOptions({})));
      else
         CHECK_THROWS_AS(Backend(code, nullptr, psibase::NativeVMOptions({})),
                         psizam::wasm_parse_exception);
   }
}

TEST_CASE("Registered native spans and unaligned pointer proxies keep their WASM ABI")
{
   Runtime runtime;
   CHECK(runtime.integer("span") == 20);
   CHECK(runtime.host.seen == "abc");
   CHECK(runtime.integer("empty") == 9);
   CHECK(runtime.integer("write") == 0x1122334455667788ull);
   CHECK(runtime.host.writes == 1);
   CHECK_THROWS(runtime.run("span-oob"));
   CHECK(runtime.host.spans == 2);
   CHECK_THROWS(runtime.run("write-oob"));
   CHECK(runtime.host.writes == 1);
}

TEST_CASE("Native memory and table growth remain inside the chain configuration")
{
   Runtime runtime({1024, 2, 3, 65536});
   CHECK(runtime.integer("grow") == 1);
   CHECK(runtime.integer("grow") == 0xffffffffu);
   CHECK(runtime.integer("grow-table") == 0xffffffffu);
   Runtime fixed({1024, 1, 1, 65536});
   CHECK(fixed.integer("indirect") == 42);
   CHECK(fixed.integer("grow-table") == 0xffffffffu);
   CHECK(fixed.integer("indirect") == 42);
}

TEST_CASE("Backend reuse resets memory globals and table state")
{
   Runtime runtime;
   CHECK(runtime.integer("counter") == 8);
   runtime.run("dirty");
   CHECK(runtime.integer("first-byte") == 120);
   runtime.backend.initialize(runtime.stack, &runtime.host);
   CHECK(runtime.integer("counter") == 8);
   CHECK(runtime.integer("first-byte") == 'a');
}

TEST_CASE("Nested native calls preserve outer memory stack and return values")
{
   Runtime runtime;
   runtime.host.nested = [&](std::int32_t input)
   {
      auto result = runtime.backend.get_context().template execute<psizam::type_converter<Host>>(
          runtime.stack, &runtime.host, psizam::detail::jit_visitor{runtime.backend.get_context()},
          runtime.backend.get_module().get_exported_function("inner"), input);
      return result->to_i32();
   };
   CHECK(runtime.integer("nested") == 43);
   CHECK(runtime.integer("first-byte") == 'a');
}

TEST_CASE("Host exceptions unwind native objects and the backend remains reusable")
{
   Runtime runtime;
   CHECK_THROWS_WITH(runtime.run("throw"), "host exception");
   CHECK(runtime.host.destructed == 1);
   CHECK(runtime.host.failurePayload.expired());
   runtime.backend.get_context().set_max_call_depth(runtime.options.max_stack_bytes);
   CHECK(runtime.integer("value") == 42);
}

#if defined(PSIBASE_VM_LLVM_AOT)
TEST_CASE("LLVM raw host trampolines release caught exception ownership")
{
   Runtime runtime;
   CHECK(runtime.integer("value") == 42);
   auto& context = runtime.backend.get_context();
   psizam::host_trampoline_t raw[] = {
       +[](void*, psizam::native_value* args, char*) -> psizam::native_value
       {
          reinterpret_cast<Host*>(args[0].i64)->fail();
          return {};
       }};
   auto previous = context._host_trampoline_ptrs;
   auto restore = psibase::finally{[&] { context._host_trampoline_ptrs = previous; }};
   context._host_trampoline_ptrs = raw;
   psizam::native_value argument{reinterpret_cast<uint64_t>(&runtime.host)};
   auto invoke = [&]
   {
      psizam::detail::invoke_with_signal_handler(
          [&] { __psizam_call_host(&context, 0, &argument, 1); },
          [](int) { throw std::runtime_error("unexpected signal in raw host callback"); },
          runtime.backend.get_module().allocator, &runtime.memory);
   };
   // This callback throws normally into the LLVM helper's own exception
   // boundary, instead of escaping inside the registered-host trampoline.
   CHECK_THROWS_WITH(invoke(), "host exception");
   CHECK(runtime.host.destructed == 1);
   CHECK(runtime.host.failurePayload.expired());
   CHECK(psizam::detail::saved_exception == nullptr);
}
#endif

TEST_CASE("Native psizam enforces byte stack limits and deterministic floating point")
{
   Runtime runtime({1024, 1, 3, 8192});
   CHECK_THROWS(runtime.run("recurse"));
   runtime.backend.get_context().set_max_call_depth(runtime.options.max_stack_bytes);
   CHECK(runtime.integer("nan") == 0x7ff8000000000000ull);
   CHECK(runtime.integer("fp") == 0x8000000000000000ull);
}

TEST_CASE("CPU watchdog cancellation uses executing-thread TLS and permits cache reuse")
{
   Runtime runtime;
   auto&   timedOut = psizam::detail::timed_run_has_timed_out;
   REQUIRE_FALSE(timedOut.load());
   auto restore = psibase::finally{[&]
                                {
                                   runtime.backend.get_module().allocator.enable_code(true);
                                   timedOut = false;
                                }};
   {
      psibase::WatchdogManager manager;
      psibase::Watchdog        watchdog(manager,
                                        [&]
                                        {
                                    timedOut = true;
                                    runtime.backend.get_module().allocator.disable_code();
                                        });
      watchdog.setLimit(std::chrono::milliseconds(20));
      CHECK_THROWS(runtime.run("loop"));
      CHECK(timedOut.load());
   }
   runtime.backend.get_module().allocator.enable_code(true);
   timedOut = false;
   runtime.backend.get_context().set_max_call_depth(runtime.options.max_stack_bytes);
   CHECK(runtime.integer("value") == 42);
}

TEST_CASE("Explicit traps retain live mapped frames and isolate nested runtimes")
{
   Runtime outer;
   Runtime inner;
   struct Observation
   {
      Runtime* runtime;
      unsigned accepted = 0;
      unsigned ignored  = 0;
      unsigned mapped   = 0;
      unsigned failures = 0;
   } observation{&outer};
   REQUIRE(psizam::detail::trap_observer == nullptr);
   {
      psizam::detail::scoped_trap_observer observer{
          +[](const char* message, void* data) noexcept
          {
             auto& value   = *static_cast<Observation*>(data);
             auto& backend = value.runtime->backend;
             if (psizam::detail::active_code_allocator != &backend.get_module().allocator)
             {
                ++value.ignored;
                return;
             }
             ++value.accepted;
             if (std::string_view(message) != "unreachable")
                ++value.failures;
             void* frames[64];
             int   count = backend.get_context().backtrace(frames, 64, nullptr);
             for (int i = 0; i < count; ++i)
                if (backend.get_debug().translate(frames[i]) != 0xffffffffu)
                   ++value.mapped;
             try
             {
                throw std::runtime_error("diagnostic failure");
             }
             catch (...)
             {
             }
          },
          &observation};
      CHECK_THROWS_WITH(inner.run("trap"), "unreachable");
      CHECK(observation.ignored == 1);
      CHECK(observation.accepted == 0);
      CHECK_THROWS_WITH(outer.run("trap"), "unreachable");
      CHECK(observation.accepted == 1);
      CHECK(observation.failures == 0);
      CHECK(observation.mapped > 0);
   }
   CHECK(psizam::detail::trap_observer == nullptr);
   CHECK(psizam::detail::trap_observer_data == nullptr);
   CHECK(psizam::detail::active_code_allocator == nullptr);
   outer.backend.get_context().set_max_call_depth(outer.options.max_stack_bytes);
   CHECK(outer.integer("value") == 42);
}

TEST_CASE("Watchdog completion and destruction cannot cancel the next backend owner")
{
   Runtime                  runtime;
   psibase::WatchdogManager manager;
   auto&                    timedOut = psizam::detail::timed_run_has_timed_out;
   auto                     restore  = psibase::finally{[&]
                                                     {
                                   runtime.backend.get_module().allocator.enable_code(true);
                                   timedOut = false;
                                                     }};
   for (unsigned i = 0; i < 40; ++i)
   {
      // A watchdog holds the same exclusive backend as a transaction; removal
      // joins an in-flight handler through the manager lock before cache return.
      {
         psibase::Watchdog watchdog(manager,
                                    [&]
                                    {
                                       timedOut = true;
                                       runtime.backend.get_module().allocator.disable_code();
                                    });
         watchdog.setLimit(std::chrono::nanoseconds(1));
         try
         {
            runtime.run("value");
         }
         catch (const psizam::timeout_exception&)
         {
         }
         catch (const psizam::wasm_memory_exception&)
         {
            // A direct context call reports the revoked code pages as a fault;
            // only the timed-run wrapper renames it.
            CHECK(timedOut.load());
         }
      }
      runtime.backend.get_module().allocator.enable_code(true);
      timedOut = false;
      runtime.backend.get_context().set_max_call_depth(runtime.options.max_stack_bytes);
      runtime.backend.initialize(runtime.stack, &runtime.host);
      CHECK(runtime.integer("value") == 42);
      CHECK_FALSE(timedOut.load());
   }
}

namespace
{
   struct NativeService
   {
      TempDirectory              directory;
      psibase::SharedDatabase    database{directory.path,
                                          {64ull << 20, 64ull << 20, 64ull << 20, 64ull << 20}};
      psibase::WasmCache         cache;
      psibase::SystemContext     system{database,
                                        cache,
                                        {},
                                        std::make_shared<psibase::WatchdogManager>(),
                                        std::make_shared<psibase::Sockets>(database)};
      psibase::BlockContext      block{system, database.getHead(), database.createWriter(), true};
      psibase::AccountNumber     service{"vm-test"};
      psibase::AccountNumber     peer{"vm-peer"};
      psibase::SignedTransaction signedTransaction;
      psibase::TransactionTrace  trace;

      // Compiled modules go to the directory `artifacts`, or to the user's
      // cache if it is empty.
      explicit NativeService(const std::filesystem::path& artifacts = {}) : cache{4, artifacts}
      {
         initialize();
      }
      explicit NativeService(std::shared_ptr<psibase::NativeAotCache> artifacts)
          : cache{4, std::move(artifacts)}
      {
         initialize();
      }
      void initialize()
      {
         REQUIRE(service.str() == "vm-test");
         REQUIRE(peer.str() == "vm-peer");
         REQUIRE(service != peer);
         static const bool registered = []
         {
            psibase::ExecutionContext::registerHostFunctions();
            return true;
         }();
         (void)registered;
         auto code = psizam::read_wasm(PSIBASE_PSIZAM_SERVICE_WASM);
         // Pass the same SDK-produced Action bytes through the real WASM host
         // span ABI, without teaching the fixture the serialization layout.
         auto patch = [&](std::string_view marker, std::uint64_t sender)
         {
            auto nested = psio::to_pssz(
                psibase::Action{.sender = psibase::AccountNumber{sender}, .service = peer});
            auto slot = std::search(code.begin(), code.end(), marker.begin(), marker.end());
            REQUIRE(slot != code.end());
            REQUIRE(code.end() - slot >= 64);
            REQUIRE(nested.size() + 4 <= 64);
            std::fill_n(slot, 64, 0);
            auto size = static_cast<std::uint32_t>(nested.size());
            std::memcpy(std::addressof(*slot), &size, sizeof(size));
            std::memcpy(std::addressof(*(slot + 4)), nested.data(), nested.size());
         };
         patch("PSIZAM_NESTED_ACTION", service.value);
         patch("PSIZAM_LOOP_ACTION", 2);
         patch("PSIZAM_THROW_ACTION", 7);
         for (auto account : {service, peer})
         {
            psibase::CodeRow row{.codeNum = account,
                                 .flags = account == service ? psibase::CodeRow::isPrivileged : 0};
            block.db.kvPut(row.db, row.key(), row);
            psibase::setCode(
                block.db, account, 0, 0,
                std::span<const char>(reinterpret_cast<const char*>(code.data()), code.size()));
         }
      }
      psibase::Action action(std::uint64_t sender = 0) const
      {
         return {.sender = psibase::AccountNumber{sender}, .service = service};
      }
      psibase::ActionTrace run(psibase::TransactionContext& transaction, std::uint64_t sender = 0)
      {
         psibase::ActionTrace result;
         transaction.execNonTrxAction(0, action(sender), result);
         return result;
      }
      psibase::ActionTrace called(psibase::TransactionContext& transaction,
                                  psibase::AccountNumber       account)
      {
         auto request    = action();
         request.service = account;
         psibase::ActionTrace result;
         transaction.execCalledAction(0, request, result);
         return result;
      }
      static std::uint32_t value(const psibase::ActionTrace& trace)
      {
         REQUIRE(trace.rawRetval.size() == 4);
         std::uint32_t value;
         std::memcpy(&value, trace.rawRetval.data(), sizeof(value));
         return value;
      }
   };
}  // namespace

TEST_CASE("Node execution owns cached backends exclusively and resets each transaction")
{
   NativeService fixture;
   // The psizam engines check a compiled backend out of the cache for the
   // length of a transaction, so the cache's mappings come and go. wasmtime
   // owns its code mappings and shares one compiled module between
   // transactions, so its cache never reports any.
   const bool checkedOut = psibase::vm::selected().name != "wasmtime";
   {
      psibase::TransactionContext first{fixture.block, fixture.signedTransaction, fixture.trace,
                                        psibase::DbMode::transaction()};
      CHECK(NativeService::value(fixture.run(first)) == 8);
      CHECK(NativeService::value(fixture.called(first, fixture.service)) == 9);
      CHECK(fixture.cache.span().empty());
      {
         psibase::TransactionContext second{fixture.block, fixture.signedTransaction, fixture.trace,
                                            psibase::DbMode::transaction()};
         CHECK(NativeService::value(fixture.run(second)) == 8);
         CHECK(fixture.cache.span().empty());
      }
      CHECK(fixture.cache.span().empty() != checkedOut);
   }
   CHECK(fixture.cache.span().empty() != checkedOut);
   auto compiled = fixture.cache.span();
   {
      // Each transaction starts from fresh service state on every engine.
      psibase::TransactionContext next{fixture.block, fixture.signedTransaction, fixture.trace,
                                       psibase::DbMode::transaction()};
      CHECK(NativeService::value(fixture.run(next)) == 8);
   }
   auto reused = fixture.cache.span();
   CHECK(reused.size() == compiled.size());
   for (auto bytes : reused)
      CHECK(std::ranges::any_of(compiled,
                                [&](auto previous) { return bytes.data() == previous.data(); }));
}

TEST_CASE("Native config writes reject VM limits that cannot be instantiated")
{
   for (auto table : {psibase::transactionWasmConfigTable, psibase::proofWasmConfigTable})
   {
      NativeService fixture;
      auto mode = psibase::DbMode::transaction();
      psibase::TransactionContext transaction{fixture.block, fixture.signedTransaction,
                                               fixture.trace, mode};
      auto action = fixture.action();
      psibase::ActionTrace trace;
      psibase::ActionContext context{transaction, action, trace};
      psibase::NativeFunctions host{
          fixture.block.db, transaction, mode,
          {.codeNum = fixture.service, .flags = psibase::CodeRow::isPrivileged}, &context};
      auto handle = host.kvOpen(static_cast<uint32_t>(psibase::DbId::native), {},
                                static_cast<uint32_t>(psibase::KvMode::write));
      auto                   key    = psio::encode(psio::key{}, psibase::WasmConfigRow::key(table));
      psibase::WasmConfigRow valid;
      auto expected = psio::to_pssz(valid);
      // Seed the existing row through the fixture's database. The host writes
      // below must fail in validation before resource notifications execute.
      fixture.block.db.kvPut(psibase::DbId::native, valid.key(table), valid);
      for (bool pages : {true, false})
      {
         auto invalid = valid;
         if (pages)
            invalid.vmOptions.max_pages = 65537;
         else
            invalid.vmOptions.max_stack_bytes = 0xffffffffu;
         CHECK_THROWS(host.kvPut(handle, key, psio::to_pssz(invalid)));
         auto retained = fixture.block.db.kvGetRaw(psibase::DbId::native, key);
         REQUIRE(retained.has_value());
         CHECK(std::ranges::equal(*retained, expected));
      }
   }
}

TEST_CASE("Node host bounds traps and watchdog timeouts leave cached code reusable")
{
   NativeService fixture;
   for (auto sender : {1u, 3u, 2u})
   {
      {
         psibase::TransactionContext transaction{fixture.block, fixture.signedTransaction,
                                                 fixture.trace, psibase::DbMode::transaction()};
         if (sender == 2)
         {
            transaction.setWatchdog(std::chrono::milliseconds(20));
            CHECK_THROWS_AS(fixture.run(transaction, sender), psibase::TimeoutException);
         }
         else
            CHECK_THROWS(fixture.run(transaction, sender));
      }
      CHECK_FALSE(psizam::detail::timed_run_has_timed_out.load());
      {
         psibase::TransactionContext next{fixture.block, fixture.signedTransaction, fixture.trace,
                                          psibase::DbMode::transaction()};
         CHECK(NativeService::value(fixture.run(next)) == 8);
      }
      CHECK_FALSE(psizam::detail::timed_run_has_timed_out.load());
   }
}

namespace
{
   // Existing preverification token envelope; this test exercises admission
   // against changed proof bytes and a verifier that must not execute on a hit.
   struct PreverifiedToken
   {
      bool                 success;
      psibase::RunMode     mode;
      psibase::Action      action;
      psibase::Checksum256 context;
      PSIO_REFLECT(PreverifiedToken, success, mode, action, context)
   };
}  // namespace

TEST_CASE("Preverified proof tokens skip only the matching verification request")
{
   NativeService fixture;
   fixture.block.active = true;
   psibase::Transaction unsignedTransaction;
   unsignedTransaction.claims.push_back({.service = fixture.service});
   psibase::SignedTransaction transaction{
       psio::shared_pssz<psibase::Transaction>{unsignedTransaction},
       {{'p', 'r', 'o', 'o', 'f'}}};
   auto id     = psibase::sha256(transaction.transaction.data(), transaction.transaction.size());
   auto verify = psibase::makeVerify(transaction, id, 0);
   auto token  = psibase::sha256(PreverifiedToken{true, psibase::RunMode::verify, verify,
                                                  fixture.block.getVerifyContextId()});
   psibase::TransactionTrace accepted;
   // The fixture is deliberately not marked as a verifier. A valid token must
   // skip execution; any request miss must fail the normal verifier admission.
   CHECK_NOTHROW(fixture.block.verifyProof(transaction, accepted, 0, std::chrono::milliseconds(200),
                                           nullptr, token));
   CHECK(accepted.actionTraces.empty());
   auto invalid = token;
   invalid[0] ^= 1;
   psibase::TransactionTrace rejected;
   CHECK_THROWS(fixture.block.verifyProof(transaction, rejected, 0, std::chrono::milliseconds(200),
                                          nullptr, invalid));
   CHECK(rejected.error.has_value());
   transaction.proofs[0].push_back('!');
   psibase::TransactionTrace changed;
   CHECK_THROWS(fixture.block.verifyProof(transaction, changed, 0, std::chrono::milliseconds(200),
                                          nullptr, token));
   CHECK(changed.error.has_value());
   CHECK_FALSE(psizam::detail::timed_run_has_timed_out.load());
}

TEST_CASE("Native cross-service calls preserve caller state stack and host span results")
{
   NativeService               fixture;
   psibase::TransactionContext transaction{fixture.block, fixture.signedTransaction, fixture.trace,
                                           psibase::DbMode::transaction()};
   auto                        result = fixture.run(transaction, 4);
   CHECK(NativeService::value(result) == 8);
   REQUIRE(result.innerTraces.size() == 1);
   auto& inner = std::get<psibase::ActionTrace>(result.innerTraces.front().inner);
   CHECK(inner.action.sender == fixture.service);
   CHECK(inner.action.service == fixture.peer);
   CHECK(NativeService::value(inner) == 8);
   CHECK(transaction.remainingStack == transaction.getWasmConfig().vmOptions.max_stack_bytes);
   // Calling the peer used its separate memory/global state, then restored the
   // outer host action context and result transport before returning to WASM.
   CHECK(NativeService::value(fixture.called(transaction, fixture.service)) == 8);
   CHECK(NativeService::value(fixture.called(transaction, fixture.peer)) == 9);
}

TEST_CASE("Alt context deadlines and errors preserve transaction and cache ownership",
          "[.alt-timeout-probe]")
{
   for (auto sender : {5u, 6u})
   {
      std::fprintf(stderr, "Checking tight alt loop %u\n", sender);
      NativeService fixture;
      {
         psibase::TransactionContext transaction{fixture.block, fixture.signedTransaction,
                                                 fixture.trace, psibase::DbMode::transaction()};
         transaction.setWatchdog(std::chrono::milliseconds(20));
         CHECK_THROWS_AS(fixture.run(transaction, sender), psibase::TimeoutException);
         CHECK_THROWS_AS(fixture.called(transaction, fixture.service), psibase::TimeoutException);
      }
      CHECK_FALSE(psizam::detail::timed_run_has_timed_out.load());
      {
         psibase::TransactionContext next{fixture.block, fixture.signedTransaction, fixture.trace,
                                          psibase::DbMode::transaction()};
         CHECK(NativeService::value(fixture.run(next)) == 8);
         CHECK(NativeService::value(fixture.called(next, fixture.peer)) == 8);
      }
   }
   for (auto sender : {8u, 9u})
   {
      std::fprintf(stderr, "Checking thrown alt host call %u\n", sender);
      NativeService fixture;
      {
         psibase::TransactionContext transaction{fixture.block, fixture.signedTransaction,
                                                 fixture.trace, psibase::DbMode::transaction()};
         CHECK_THROWS_WITH(fixture.run(transaction, sender),
                           Catch::Matchers::ContainsSubstring("alt fixture failure"));
         CHECK(transaction.remainingStack == transaction.getWasmConfig().vmOptions.max_stack_bytes);
         CHECK(NativeService::value(fixture.called(transaction, fixture.service)) == 8);
         CHECK(fixture.cache.span().empty());
      }
      {
         psibase::TransactionContext next{fixture.block, fixture.signedTransaction, fixture.trace,
                                          psibase::DbMode::transaction()};
         CHECK(NativeService::value(fixture.run(next)) == 8);
      }
   }
   for (unsigned attempt = 0; attempt < 8; ++attempt)
   {
      std::fprintf(stderr, "Checking replay alt clear race %u\n", attempt);
      NativeService fixture;
      fixture.block.isProducing = false;
      fixture.signedTransaction.subjectiveData.emplace(100000, std::vector<char>{});
      {
         psibase::TransactionContext transaction{fixture.block, fixture.signedTransaction,
                                                 fixture.trace, psibase::DbMode::transaction()};
         transaction.setWatchdog(std::chrono::milliseconds(2));
         CHECK_THROWS_AS(fixture.run(transaction, 10), psibase::TimeoutException);
      }
      CHECK_FALSE(psizam::detail::timed_run_has_timed_out.load());
      {
         psibase::TransactionContext next{fixture.block, fixture.signedTransaction, fixture.trace,
                                          psibase::DbMode::transaction()};
         CHECK(NativeService::value(fixture.run(next)) == 8);
      }
   }
}

TEST_CASE("A block being produced takes transactions up to the chain's size limit")
{
   NativeService fixture;
   auto&         block = fixture.block;
   auto          sized = [](std::size_t bytes, std::size_t proofBytes = 0)
   {
      psibase::Transaction transaction;
      transaction.actions.push_back(psibase::Action{.rawData = std::vector<char>(bytes)});
      psibase::SignedTransaction result;
      result.transaction = psio::shared_pssz<psibase::Transaction>{transaction};
      if (proofBytes)
         result.proofs.push_back(std::vector<char>(proofBytes));
      return result;
   };
   // A transaction counts for its packed size plus its proofs.
   const auto small = sized(100);
   const auto base  = psibase::BlockContext::blockBytes(small);
   CHECK(base >= 100);
   CHECK(psibase::BlockContext::blockBytes(sized(100, 40)) == base + 40);
   auto withSubjective           = sized(100);
   withSubjective.subjectiveData = {std::vector<char>(5000)};
   CHECK(psibase::BlockContext::blockBytes(withSubjective) == base);

   block.maxBlockSize     = 1000;
   block.transactionBytes = 0;
   block.current.transactions.clear();
   // The first transaction always fits, however large.
   CHECK(block.fits(sized(100000)));
   // After that, only what stays within the limit.
   block.current.transactions.push_back(small);
   block.transactionBytes = base;
   CHECK(block.fits(sized(100)));
   CHECK(block.fits(sized(1000 - 2 * base + 100)));
   CHECK_FALSE(block.fits(sized(1000 - 2 * base + 101)));
   CHECK_FALSE(block.fits(sized(100000)));
   // Exactly full takes nothing more.
   block.transactionBytes = 1000;
   CHECK_FALSE(block.fits(sized(0)));

   // What a validator requires of a block it receives.
   auto received = [&](std::size_t count, std::uint64_t bytes, bool genesis)
   {
      block.isGenesisBlock = genesis;
      block.current.transactions.assign(count, small);
      block.transactionBytes = bytes;
      block.checkBlockSize();
   };
   CHECK_NOTHROW(received(0, 0, false));
   CHECK_NOTHROW(received(5, 1000, false));
   CHECK_THROWS_WITH(received(5, 1001, false), "block exceeds maxBlockSize");
   CHECK_THROWS_WITH(received(2, 100000, false), "block exceeds maxBlockSize");
   // One transaction is allowed whatever its size, and so is the genesis block.
   CHECK_NOTHROW(received(1, 100000, false));
   CHECK_NOTHROW(received(40, 100000, true));
}

namespace
{
   // A privileged service's native writes, without a wasm service to make
   // them: the same host function, in the same transaction context. A write
   // to the chain's native database reports to the transaction service
   // (kvNotify), so the fixture's service is installed as that too.
   struct CodeWriter
   {
      NativeService&              fixture;
      psibase::DbMode             mode;
      psibase::TransactionContext transaction{fixture.block, fixture.signedTransaction,
                                              fixture.trace, mode};
      psibase::Action             action = fixture.action();
      psibase::ActionTrace        trace;
      psibase::ActionContext      context{transaction, action, trace};
      psibase::NativeFunctions    host{
          fixture.block.db,
          transaction,
          mode,
          {.codeNum = fixture.service,
           .flags   = psibase::CodeRow::isPrivileged |
                      (mode.isSubjective ? psibase::ExecutionContext::isLocal : 0)},
          &context};
      // What the cache had done once this writer was ready.
      psibase::WasmCacheStats before;

      explicit CodeWriter(NativeService&  fixture,
                          psibase::DbMode mode = psibase::DbMode::transaction())
          : fixture(fixture), mode(mode)
      {
         auto& db = fixture.block.db;
         auto  transact =
             db.kvGet<psibase::CodeRow>(psibase::CodeRow::db, psibase::codeKey(fixture.service))
                 .value();
         transact.codeNum = psibase::transactionServiceNum;
         db.kvPut(transact.db, transact.key(), transact);
         // Running the service gives the transaction its limits and the
         // host the execution context a write reports through.
         fixture.run(transaction);
         host.currentExecContext = &transaction.getExecutionContext(fixture.service);
         before                  = fixture.cache.stats();
      }
      std::uint64_t compiled() const { return fixture.cache.stats().compiled - before.compiled; }
      std::uint64_t loaded() const { return fixture.cache.stats().loaded - before.loaded; }

      static psibase::CodeByHashRow row(const std::vector<std::uint8_t>& code)
      {
         return {.codeHash = psibase::sha256(code.data(), code.size()), .code = code};
      }
      void put(psibase::DbId db, const psibase::CodeByHashRow& value)
      {
         // Node-local state is written inside a subjective checkout.
         auto& database = fixture.block.db;
         bool  open     = mode.isSubjective;
         if (open)
            database.checkoutSubjective();
         auto abort  = psibase::finally{[&]
                                        {
                                          if (open)
                                             database.abortSubjective();
                                        }};
         auto handle = host.kvOpen(static_cast<uint32_t>(db), {},
                                   static_cast<uint32_t>(psibase::KvMode::write));
         host.kvPut(handle, psio::encode(psio::key{}, value.key()), psio::to_pssz(value));
         if (open)
         {
            open = false;
            REQUIRE(database.commitSubjective(*fixture.system.sockets, transaction.ownedSockets));
         }
      }
      void put(psibase::DbId db, const std::vector<std::uint8_t>& code) { put(db, row(code)); }
      bool stored(psibase::DbId db, const std::vector<std::uint8_t>& code)
      {
         auto& database = fixture.block.db;
         if (mode.isSubjective)
            database.checkoutSubjective();
         auto abort = psibase::finally{[&]
                                       {
                                          if (mode.isSubjective)
                                             database.abortSubjective();
                                       }};
         return database.kvGetRaw(db, psio::encode(psio::key{}, row(code).key())).has_value();
      }
      // The first call of a transaction to `account`.
      static std::uint32_t call(NativeService&               fixture,
                                psibase::TransactionContext& transaction,
                                psibase::AccountNumber       account)
      {
         auto request    = fixture.action();
         request.service = account;
         psibase::ActionTrace result;
         transaction.execNonTrxAction(0, request, result);
         return NativeService::value(result);
      }
   };

   std::vector<std::uint8_t> wasmModule(std::initializer_list<std::uint8_t> sections)
   {
      std::vector<std::uint8_t> code{0, 'a', 's', 'm', 1, 0, 0, 0};
      code.insert(code.end(), sections);
      return code;
   }

   void leb(std::vector<std::uint8_t>& out, std::uint32_t value)
   {
      for (; value >= 0x80; value >>= 7)
         out.push_back(static_cast<std::uint8_t>(value | 0x80));
      out.push_back(static_cast<std::uint8_t>(value));
   }

   void section(std::vector<std::uint8_t>&       out,
                std::uint8_t                     id,
                const std::vector<std::uint8_t>& body)
   {
      out.push_back(id);
      leb(out, body.size());
      out.insert(out.end(), body.begin(), body.end());
   }

   // What a module built by hand needs to be admitted as a service: the two
   // entry points every service exports, `start` and `called`, with empty
   // bodies. The caller appends `types` to its type section (they become
   // types `firstType` and `firstType + 1`) and `bodies` to its code
   // section, and emits `functions` and `exports` as given if it declares
   // no other function or export; the two functions are then
   // `firstFunction` and `firstFunction + 1`.
   struct EntryPoints
   {
      std::vector<std::uint8_t> types{0x60, 1, 0x7e, 0, 0x60, 2, 0x7e, 0x7e, 0};
      std::vector<std::uint8_t> functions, exports;
      std::vector<std::uint8_t> bodies{2, 0, 0x0b, 2, 0, 0x0b};
      EntryPoints(std::uint32_t firstType, std::uint32_t firstFunction)
      {
         leb(functions, firstType);
         leb(functions, firstType + 1);
         exports = {5, 's', 't', 'a', 'r', 't', 0};
         leb(exports, firstFunction);
         exports.insert(exports.end(), {6, 'c', 'a', 'l', 'l', 'e', 'd', 0});
         leb(exports, firstFunction + 1);
      }
   };

   // A valid module that takes far longer to compile than to admit:
   // `functions` functions of `steps` arithmetic steps each. `salt` makes
   // otherwise equal modules different code. It is a service: it also has
   // the two entry points.
   std::vector<std::uint8_t> largeModule(std::uint32_t functions,
                                         std::uint32_t steps,
                                         std::uint32_t salt)
   {
      std::vector<std::uint8_t> body{0, 0x20, 0};  // no locals; local.get 0
      for (std::uint32_t i = 0; i < steps; ++i)
      {
         body.push_back(0x41);  // i32.const
         leb(body, (salt + i) & 0x3f);
         body.push_back(i % 3 ? 0x6a : 0x6c);       // i32.add or i32.mul
         body.insert(body.end(), {0x20, 0, 0x73});  // local.get 0; i32.xor
      }
      body.push_back(0x0b);
      const EntryPoints         entry{1, functions};
      std::vector<std::uint8_t> types{3, 0x60, 1, 0x7f, 1, 0x7f};  // type 0: (i32) -> i32
      std::vector<std::uint8_t> declared, exported{2}, code;
      types.insert(types.end(), entry.types.begin(), entry.types.end());
      leb(declared, functions + 2);
      leb(code, functions + 2);
      for (std::uint32_t i = 0; i < functions; ++i)
      {
         declared.push_back(0);
         leb(code, body.size());
         code.insert(code.end(), body.begin(), body.end());
      }
      declared.insert(declared.end(), entry.functions.begin(), entry.functions.end());
      exported.insert(exported.end(), entry.exports.begin(), entry.exports.end());
      code.insert(code.end(), entry.bodies.begin(), entry.bodies.end());
      auto result = wasmModule({});
      section(result, 1, types);
      section(result, 3, declared);
      section(result, 7, exported);
      section(result, 10, code);
      return result;
   }

   bool isWasmtime()
   {
      return psibase::vm::selected().name == "wasmtime";
   }
}  // namespace

TEST_CASE("Service code is admitted when its row is written, in every execution mode")
{
   struct Refused
   {
      std::vector<std::uint8_t> code;
      std::string               reason;
   };
   const std::vector<Refused> refused = {
       {{'n', 'o', 't', ' ', 'a', ' ', 'm', 'o', 'd', 'u', 'l', 'e'}, "invalid native WASM header"},
       // Syntactically valid, against the chain policy: an imported memory,
       // and a memory larger than max_pages (513 pages against 512).
       {wasmModule({2, 7, 1, 0, 0, 2, 0, 1, 0}), "native WASM permits function imports only"},
       {wasmModule({5, 4, 1, 0, 0x81, 0x04}), "native WASM exceeds max_pages"},
       // Passes the declaration check and fails psizam's validator: a
       // function declared to return an i32 that returns nothing.
       {wasmModule({1, 5, 1, 0x60, 0, 1, 0x7f, 3, 2, 1, 0, 10, 4, 1, 2, 0, 0x0b}), ""},
   };
   const auto valid = psizam::read_wasm(PSIBASE_PSIZAM_SERVICE_WASM);

   struct Mode
   {
      const char*     name;
      psibase::DbMode mode;
      bool            producing;
      psibase::DbId   db;
   };
   for (auto [name, mode, producing, db] :
        {Mode{"block being produced", psibase::DbMode::transaction(), true, psibase::DbId::native},
         Mode{"block being applied", psibase::DbMode::transaction(), false, psibase::DbId::native},
         Mode{"speculative", psibase::DbMode::speculative(), true, psibase::DbId::native},
         Mode{"node-local", psibase::DbMode::callback(), true, psibase::DbId::nativeSubjective}})
   {
      INFO(name);
      TempDirectory artifacts;
      NativeService fixture{artifacts.path / "modules"};
      fixture.block.isProducing = producing;
      CodeWriter writer{fixture, mode};
      for (const auto& [code, reason] : refused)
      {
         if (reason.empty())
            CHECK_THROWS(writer.put(db, code));
         else
            CHECK_THROWS_WITH(writer.put(db, code), Catch::Matchers::ContainsSubstring(reason));
         CHECK_FALSE(writer.stored(db, code));
         CHECK_FALSE(fixture.cache.contains(CodeWriter::row(code).codeHash, {}, 0));
      }
      // A version no float profile is defined for is refused, whatever the code.
      {
         auto unknown      = CodeWriter::row(valid);
         unknown.vmVersion = 7;
         CHECK_THROWS_WITH(writer.put(db, unknown),
                           Catch::Matchers::ContainsSubstring("vmVersion is not supported"));
      }
      CHECK(writer.compiled() == 0);

      CHECK_NOTHROW(writer.put(db, valid));
      CHECK(writer.stored(db, valid));
      // A node applying a block compiles in the background; everything
      // else here has compiled by the time the write returns.
      if (!producing)
         fixture.cache.finishCompiles();
      if (isWasmtime())
      {
         // Compiled where it was stored: in memory and in the artifact
         // store before anything executes it.
         const auto hash = CodeWriter::row(valid).codeHash;
         CHECK(fixture.cache.contains(hash, {}, 0));
         CHECK(writer.compiled() == 1);
         // Written again (removed and re-added): admitted again, not recompiled.
         CHECK_NOTHROW(writer.put(db, valid));
         CHECK(writer.compiled() == 1);
         CHECK(writer.loaded() == 0);
      }
   }
}

TEST_CASE("The first execution of stored code finds it compiled")
{
   if (!isWasmtime())
      SKIP("only wasmtime compiles where the code is stored");
   TempDirectory artifacts;
   NativeService fixture{artifacts.path / "modules"};
   // Other code than the fixture's, deployed to a new account by a write.
   auto code = psizam::read_wasm(PSIBASE_PSIZAM_SERVICE_WASM);
   code.insert(code.end(), {0, 5, 4, 't', 'e', 's', 't'});  // a custom section
   const auto                   hash = CodeWriter::row(code).codeHash;
   const psibase::AccountNumber account{"vm-stored"};
   {
      CodeWriter writer{fixture};
      CHECK_FALSE(fixture.cache.contains(hash, {}, 0));
      writer.put(psibase::DbId::native, code);
      CHECK(writer.compiled() == 1);
      CHECK(fixture.cache.contains(hash, {}, 0));
      psibase::CodeRow row{.codeNum = account, .codeHash = hash};
      fixture.block.db.kvPut(row.db, row.key(), row);
      // Its first execution, in the transaction that stored it and in the next.
      CHECK(NativeService::value(fixture.called(writer.transaction, account)) == 8);
      CHECK(writer.compiled() == 1);
      CHECK(writer.loaded() == 0);
   }
   const auto before = fixture.cache.stats();
   {
      psibase::TransactionContext transaction{fixture.block, fixture.signedTransaction,
                                              fixture.trace, psibase::DbMode::transaction()};
      CHECK(CodeWriter::call(fixture, transaction, account) == 8);
   }
   CHECK(fixture.cache.stats().compiled == before.compiled);
   CHECK(fixture.cache.stats().loaded == before.loaded);

   // A node that starts later with the same artifact store loads the module
   // when the code is written (applying the block) and compiles nothing new.
   NativeService restarted{artifacts.path / "modules"};
   CodeWriter    writer{restarted};
   writer.put(psibase::DbId::native, code);
   CHECK(writer.compiled() == 0);
   CHECK(writer.loaded() == 1);
   CHECK(restarted.cache.contains(hash, {}, 0));
}

TEST_CASE("Code the engine's compiler refuses after admission is stored, not a transaction error")
{
   // A module the chain admits and wasmtime's compiler refuses. With every
   // limit a chain value below the engines' own (gofractally/psibase#2262)
   // the known ones are gone; this is one that is left, a defect
   // (gofractally/psizam#6): a block whose type is the non-null typed
   // reference (ref func), which psizam's parser reads as funcref and
   // wasmtime refuses without the function-references proposal. When that
   // is fixed this test needs another example. Such a refusal must not
   // decide the transaction: another engine compiles it.
   // start and called (empty), and a third function with that block.
   const EntryPoints         entry{0, 0};
   std::vector<std::uint8_t> types{3}, declared{3}, exported{2}, bodies{3};
   types.insert(types.end(), entry.types.begin(), entry.types.end());
   types.insert(types.end(), {0x60, 0, 0});  // type 2: () -> ()
   declared.insert(declared.end(), entry.functions.begin(), entry.functions.end());
   declared.push_back(2);
   exported.insert(exported.end(), entry.exports.begin(), entry.exports.end());
   bodies.insert(bodies.end(), entry.bodies.begin(), entry.bodies.end());
   bodies.insert(bodies.end(), {8, 0, 0x02, 0x64, 0x70, 0x00, 0x0b, 0x1a, 0x0b});
   auto code = wasmModule({});
   section(code, 1, types);
   section(code, 3, declared);
   section(code, 7, exported);
   section(code, 10, bodies);
   CHECK_NOTHROW(psibase::admitNativeWasm(code, {}, 0));
   TempDirectory artifacts;
   NativeService fixture{artifacts.path / "modules"};
   CodeWriter    writer{fixture};
   CHECK_NOTHROW(writer.put(psibase::DbId::native, code));
   CHECK(writer.stored(psibase::DbId::native, code));
   if (isWasmtime())
   {
      CHECK_FALSE(fixture.cache.contains(CodeWriter::row(code).codeHash, {}, 0));
      CHECK(writer.compiled() == 0);
      // It fails where it failed before admission moved to the write: at
      // its first execution on this engine.
      const psibase::AccountNumber account{"vm-refused"};
      psibase::CodeRow row{.codeNum = account, .codeHash = CodeWriter::row(code).codeHash};
      fixture.block.db.kvPut(row.db, row.key(), row);
      CHECK_THROWS_WITH(fixture.called(writer.transaction, account),
                        Catch::Matchers::ContainsSubstring("function references required"));
   }
}

namespace
{
   struct Import
   {
      std::string               module, name;
      std::vector<std::uint8_t> params, results;
      std::uint8_t              kind = 0;  // 0 function, 1 table, 2 memory, 3 global
   };
   // A service that only imports: one function type per function import,
   // and the two entry points every service must have.
   std::vector<std::uint8_t> importing(const std::vector<Import>& imports)
   {
      std::vector<std::uint8_t> types, section;
      std::uint32_t             functions = 0;
      leb(section, imports.size());
      for (const auto& import : imports)
      {
         leb(section, import.module.size());
         section.insert(section.end(), import.module.begin(), import.module.end());
         leb(section, import.name.size());
         section.insert(section.end(), import.name.begin(), import.name.end());
         section.push_back(import.kind);
         switch (import.kind)
         {
            case 0:
               types.push_back(0x60);
               leb(types, import.params.size());
               types.insert(types.end(), import.params.begin(), import.params.end());
               leb(types, import.results.size());
               types.insert(types.end(), import.results.begin(), import.results.end());
               leb(section, functions++);
               break;
            case 1:
               section.insert(section.end(), {0x70, 0, 0});  // funcref, no maximum, 0 elements
               break;
            case 2:
               section.insert(section.end(), {0, 1});  // no maximum, 1 page
               break;
            default:
               section.insert(section.end(), {0x7f, 0});  // i32, immutable
         }
      }
      const EntryPoints         entry{functions, functions};
      std::vector<std::uint8_t> typeSection, declared{2}, exported{2}, code{2};
      leb(typeSection, functions + 2);
      typeSection.insert(typeSection.end(), types.begin(), types.end());
      typeSection.insert(typeSection.end(), entry.types.begin(), entry.types.end());
      declared.insert(declared.end(), entry.functions.begin(), entry.functions.end());
      exported.insert(exported.end(), entry.exports.begin(), entry.exports.end());
      code.insert(code.end(), entry.bodies.begin(), entry.bodies.end());
      auto result = wasmModule({});
      ::section(result, 1, typeSection);
      ::section(result, 2, section);
      ::section(result, 3, declared);
      ::section(result, 7, exported);
      ::section(result, 10, code);
      return result;
   }
   constexpr std::uint8_t i32 = 0x7f, i64 = 0x7e;
}  // namespace

TEST_CASE("The host functions a service may import are a fixed table")
{
   // A consensus rule: this list changes only with the chain's rules.
   // name(params)->results, in the order of NativeHostFunctions.hpp.
   std::string table;
   for (const auto& function : psibase::nativeHostFunctions())
   {
      auto types = [](const std::vector<std::uint8_t>& list)
      {
         std::string text;
         for (auto type : list)
            text += type == 0x7f   ? "i"
                    : type == 0x7e ? "I"
                    : type == 0x7d ? "f"
                    : type == 0x7c ? "F"
                                   : "?";
         return text;
      };
      table += std::string(function.module) + "." + std::string(function.name) + "(" +
               types(function.params) + ")" + types(function.results) + " ";
   }
   // i is i32, I is i64.
   CHECK(table ==
         "env.getResult(iii)i env.getKey(ii)i env.writeConsole(ii) env.abortMessage(ii) "
         "env.clockTimeGet(ii)i env.getRandom(ii) env.setMaxCpuTime(I) env.getCurrentAction()i "
         "env.call(iiI)i env.setRetval(ii) env.kvOpen(iiii)i env.kvOpenAt(iiii)i env.kvClose(i) "
         "env.exportHandles(ii) env.importHandles()i env.kvPut(iiiii) env.kvRemove(iii) "
         "env.kvGet(iii)i env.kvGreaterEqual(iiii)i env.kvLessThan(iiii)i env.kvMax(iii)i "
         "env.checkoutSubjective() env.commitSubjective()i env.abortSubjective() "
         "env.socketOpen(ii)i env.socketSend(iiii)i env.socketSetFlags(iii)i env.readFile(ii)i ");

   // A module that imports every one of them, as the table has it, is
   // admitted; so is one that imports the same function twice.
   std::vector<Import> all;
   for (const auto& function : psibase::nativeHostFunctions())
      all.push_back({std::string(function.module), std::string(function.name), function.params,
                     function.results});
   CHECK(all.size() == 28);
   CHECK_NOTHROW(psibase::admitNativeWasm(importing(all), {}, 0));
   all.push_back(all.front());
   all.push_back(all.back());
   CHECK_NOTHROW(psibase::admitNativeWasm(importing(all), {}, 0));

   // And the engine this node runs links and instantiates that module: the
   // engine provides what admission promises.
   NativeService fixture;
   CodeWriter    writer{fixture};
   auto          code = importing(all);
   CHECK_NOTHROW(writer.put(psibase::DbId::native, code));
   const psibase::AccountNumber account{"vm-imports"};
   psibase::CodeRow row{.codeNum = account, .codeHash = CodeWriter::row(code).codeHash};
   fixture.block.db.kvPut(row.db, row.key(), row);
   // Its entry points do nothing: calling it succeeds, so it was linked.
   CHECK_NOTHROW(fixture.called(writer.transaction, account));
}

TEST_CASE("Code that imports what the node does not provide is refused when it is stored")
{
   struct Refused
   {
      const char*         what;
      std::vector<Import> imports;
      std::string         reason;
   };
   const Import setRetval{"env", "setRetval", {i32, i32}, {}};
   const std::vector<Refused> refused = {
       {"unknown name",
        {setRetval, {"env", "nosuch", {i32}, {}}},
        "native WASM imports env.nosuch, which is not a host function"},
       {"wrong parameter types",
        {{"env", "setRetval", {i32, i64}, {}}},
        "native WASM imports env.setRetval with a signature that is not the host function's"},
       {"missing parameter",
        {{"env", "setRetval", {i32}, {}}},
        "native WASM imports env.setRetval with a signature that is not the host function's"},
       {"wrong result type",
        {{"env", "setRetval", {i32, i32}, {i32}}},
        "native WASM imports env.setRetval with a signature that is not the host function's"},
       {"another module",
        {{"wasi_snapshot_preview1", "setRetval", {i32, i32}, {}}},
        "native WASM imports wasi_snapshot_preview1.setRetval, which is not a host function"},
       {"a memory", {{"env", "memory", {}, {}, 2}}, "native WASM permits function imports only"},
       {"a table", {{"env", "table", {}, {}, 1}}, "native WASM permits function imports only"},
       {"a global", {{"env", "global", {}, {}, 3}}, "native WASM permits function imports only"},
   };
   for (const auto& [what, imports, reason] : refused)
   {
      INFO(what);
      CHECK_THROWS_WITH(psibase::admitNativeWasm(importing(imports), {}, 0),
                        Catch::Matchers::ContainsSubstring(reason));
   }

   // Through the write of the code row, in every execution mode.
   struct Mode
   {
      const char*     name;
      psibase::DbMode mode;
      bool            producing;
      psibase::DbId   db;
   };
   for (auto [name, mode, producing, db] :
        {Mode{"block being produced", psibase::DbMode::transaction(), true, psibase::DbId::native},
         Mode{"block being applied", psibase::DbMode::transaction(), false, psibase::DbId::native},
         Mode{"speculative", psibase::DbMode::speculative(), true, psibase::DbId::native},
         Mode{"node-local", psibase::DbMode::callback(), true, psibase::DbId::nativeSubjective}})
   {
      NativeService fixture;
      fixture.block.isProducing = producing;
      CodeWriter writer{fixture, mode};
      for (const auto& [what, imports, reason] : refused)
      {
         INFO(name << ", " << what);
         const auto code = importing(imports);
         CHECK_THROWS_WITH(writer.put(db, code), Catch::Matchers::ContainsSubstring(reason));
         CHECK_FALSE(writer.stored(db, code));
      }
      CHECK(writer.compiled() == 0);
      const auto good = importing({setRetval, setRetval});
      CHECK_NOTHROW(writer.put(db, good));
      CHECK(writer.stored(db, good));
   }
}

namespace
{
   struct Export
   {
      std::string               name;
      std::vector<std::uint8_t> params, results;
      std::uint8_t              kind = 0;  // 0 function, 2 memory, 3 global
   };
   // A module with `imported` imports of env.setRetval, then one function per
   // function export in order (so the n-th has index imported + n), one
   // memory and one global.
   std::vector<std::uint8_t> exporting(const std::vector<Export>& exports, std::uint32_t imported)
   {
      std::uint32_t functions = 0;
      for (const auto& e : exports)
         functions += e.kind == 0;
      std::vector<std::uint8_t> types, imports, declared, exported, code;
      leb(types, functions + 1);
      types.insert(types.end(), {0x60, 2, 0x7f, 0x7f, 0});  // type 0: env.setRetval
      leb(imports, imported);
      for (std::uint32_t i = 0; i < imported; ++i)
         imports.insert(imports.end(),
                        {3, 'e', 'n', 'v', 9, 's', 'e', 't', 'R', 'e', 't', 'v', 'a', 'l', 0, 0});
      leb(declared, functions);
      leb(exported, exports.size());
      leb(code, functions);
      std::uint32_t function = 0;
      for (const auto& e : exports)
      {
         leb(exported, e.name.size());
         exported.insert(exported.end(), e.name.begin(), e.name.end());
         exported.push_back(e.kind);
         if (e.kind != 0)
         {
            exported.push_back(0);  // the memory, or the global
            continue;
         }
         types.push_back(0x60);
         leb(types, e.params.size());
         types.insert(types.end(), e.params.begin(), e.params.end());
         leb(types, e.results.size());
         types.insert(types.end(), e.results.begin(), e.results.end());
         leb(declared, function + 1);
         leb(exported, imported + function);
         code.insert(code.end(), {3, 0, 0x00, 0x0b});  // no locals; unreachable; end
         ++function;
      }
      auto result = wasmModule({});
      section(result, 1, types);
      section(result, 2, imports);
      section(result, 3, declared);
      section(result, 5, {1, 0, 1});                 // one memory of one page
      section(result, 6, {1, 0x7f, 0, 0x41, 0, 0x0b});  // one immutable i32 global
      section(result, 7, exported);
      section(result, 10, code);
      return result;
   }
}  // namespace

TEST_CASE("The entry points a service exports have their fixed signatures")
{
   const Export start{"start", {i64}, {}}, called{"called", {i64, i64}, {}}, serve{"serve", {}, {}},
       processTransaction{"processTransaction", {}, {}};

   // Admitted, and where admission says they are. Function indices count
   // the imported functions first.
   {
      auto found = psibase::admitNativeWasm(
                       exporting({start, called, serve, processTransaction}, 0), {}, 0)
                       .entryPoints;
      CHECK(found == psibase::NativeEntryPoints{0u, 1u, 2u, 3u});
      found = psibase::admitNativeWasm(
                  exporting({serve, {"other", {i32}, {i32}}, called, start}, 3), {}, 0)
                  .entryPoints;
      CHECK(found == psibase::NativeEntryPoints{6u, 5u, 3u, std::nullopt});
      // start and called are all a service must have; other exports are its own.
      found = psibase::admitNativeWasm(
                  exporting({{"other", {i64}, {i64}}, called, {"memory", {}, {}, 2}, start}, 1),
                  {}, 0)
                  .entryPoints;
      CHECK(found == psibase::NativeEntryPoints{3u, 2u, std::nullopt, std::nullopt});
   }

   // A module without start, without called, or without either is refused,
   // by name; serve and processTransaction do not stand in for them.
   struct Missing
   {
      std::string         what;
      std::vector<Export> exports;
      std::string         reason;
   };
   const std::string       noStart  = "native WASM must export start, a function (i64) -> ()";
   const std::string       noCalled = "native WASM must export called, a function (i64, i64) -> ()";
   const std::vector<Missing> missing = {
       {"no start", {called, serve, processTransaction}, noStart},
       {"no called", {start, serve, processTransaction}, noCalled},
       {"neither", {serve, processTransaction, {"other", {i64}, {i64}}}, noStart},
       {"no export at all", {}, noStart},
       // The name on something that is not the entry point does not count.
       {"start under another name", {{"Start", {i64}, {}}, called}, noStart},
   };
   for (const auto& [what, exports, reason] : missing)
   {
      INFO(what);
      CHECK_THROWS_WITH(psibase::admitNativeWasm(exporting(exports, 2), {}, 0),
                        Catch::Matchers::ContainsSubstring(reason));
   }
   CHECK_THROWS_WITH(psibase::admitNativeWasm(wasmModule({}), {}, 0),
                     Catch::Matchers::ContainsSubstring(noStart));

   struct Refused
   {
      std::string what;
      Export      exported;
      std::string reason;
   };
   std::vector<Refused> refused;
   for (const auto& [entry, signature] :
        {std::pair{start, "(i64) -> ()"}, std::pair{called, "(i64, i64) -> ()"},
         std::pair{serve, "() -> ()"}, std::pair{processTransaction, "() -> ()"}})
   {
      const auto reason =
          "native WASM export " + entry.name + " must be a function " + signature;
      auto wrongType = entry;
      if (wrongType.params.empty())
         wrongType.params = {i32};
      else
         wrongType.params.back() = i32;
      auto extra = entry;
      extra.params.push_back(i64);
      auto result    = entry;
      result.results = {i32};
      refused.push_back({entry.name + ": wrong parameter type", wrongType, reason});
      refused.push_back({entry.name + ": one parameter too many", extra, reason});
      if (!entry.params.empty())
      {
         auto missing = entry;
         missing.params.pop_back();
         refused.push_back({entry.name + ": one parameter too few", missing, reason});
      }
      refused.push_back({entry.name + ": a result", result, reason});
      refused.push_back({entry.name + ": a global", {entry.name, {}, {}, 3}, reason});
      refused.push_back({entry.name + ": a memory", {entry.name, {}, {}, 2}, reason});
   }
   for (const auto& [what, exported, reason] : refused)
   {
      INFO(what);
      CHECK_THROWS_WITH(psibase::admitNativeWasm(exporting({exported}, 2), {}, 0),
                        Catch::Matchers::ContainsSubstring(reason));
   }

   // Through the write of the code row, in every execution mode.
   struct Mode
   {
      const char*     name;
      psibase::DbMode mode;
      bool            producing;
      psibase::DbId   db;
   };
   for (auto [name, mode, producing, db] :
        {Mode{"block being produced", psibase::DbMode::transaction(), true, psibase::DbId::native},
         Mode{"block being applied", psibase::DbMode::transaction(), false, psibase::DbId::native},
         Mode{"speculative", psibase::DbMode::speculative(), true, psibase::DbId::native},
         Mode{"node-local", psibase::DbMode::callback(), true, psibase::DbId::nativeSubjective}})
   {
      NativeService fixture;
      fixture.block.isProducing = producing;
      CodeWriter writer{fixture, mode};
      for (const auto& [what, exported, reason] : refused)
      {
         INFO(name << ", " << what);
         const auto code = exporting({exported}, 1);
         CHECK_THROWS_WITH(writer.put(db, code), Catch::Matchers::ContainsSubstring(reason));
         CHECK_FALSE(writer.stored(db, code));
      }
      for (const auto& [what, exports, reason] : missing)
      {
         INFO(name << ", " << what);
         const auto code = exporting(exports, 1);
         CHECK_THROWS_WITH(writer.put(db, code), Catch::Matchers::ContainsSubstring(reason));
         CHECK_FALSE(writer.stored(db, code));
      }
      CHECK(writer.compiled() == 0);
      // Both required ones and neither optional one: admitted.
      const auto least = exporting({start, called}, 1);
      CHECK_NOTHROW(writer.put(db, least));
      CHECK(writer.stored(db, least));
      const auto good = exporting({start, called, serve, processTransaction}, 1);
      CHECK_NOTHROW(writer.put(db, good));
      CHECK(writer.stored(db, good));
      // And it runs: the node calls start and called.
      const psibase::AccountNumber account{"vm-entry"};
      psibase::CodeRow row{.codeNum = account, .codeHash = CodeWriter::row(good).codeHash};
      if (db == psibase::DbId::native)
      {
         fixture.block.db.kvPut(row.db, row.key(), row);
         // Its start is `unreachable`: reached means found and called.
         CHECK_THROWS_WITH(fixture.called(writer.transaction, account),
                           Catch::Matchers::ContainsSubstring("unreachable"));
      }
   }
}

TEST_CASE("A damaged stored artifact is discarded and the service compiled again")
{
   if (!isWasmtime())
      SKIP("counts compiles, which only the wasmtime engine reports");
   TempDirectory artifacts;
   const auto    directory = artifacts.path / "modules";
   auto          run       = [&]
   {
      NativeService               fixture{directory};
      psibase::TransactionContext transaction{fixture.block, fixture.signedTransaction,
                                              fixture.trace, psibase::DbMode::transaction()};
      CHECK(NativeService::value(fixture.run(transaction)) == 8);
      return fixture.cache.stats();
   };
   auto only = [&]
   {
      std::vector<std::filesystem::path> files;
      for (const auto& entry : std::filesystem::directory_iterator(directory))
         files.push_back(entry.path());
      REQUIRE(files.size() == 1);
      return files.front();
   };
   auto stats = run();
   CHECK(stats.compiled == 1);
   CHECK(stats.loaded == 0);
   stats = run();
   CHECK(stats.compiled == 0);
   CHECK(stats.loaded == 1);
   CHECK(stats.discarded == 0);

   const auto file   = only();
   const auto size   = std::filesystem::file_size(file);
   auto       damage = [&](auto change)
   {
      {
         std::fstream io(file, std::ios::in | std::ios::out | std::ios::binary);
         REQUIRE(io);
         change(io);
      }
      auto result = run();
      CHECK(result.discarded == 1);
      CHECK(result.compiled == 1);
      CHECK(result.loaded == 0);
      // What replaced it is good again.
      CHECK(std::filesystem::file_size(only()) == size);
      result = run();
      CHECK(result.discarded == 0);
      CHECK(result.loaded == 1);
   };
   // One bit of native code.
   damage(
       [&](std::fstream& io)
       {
          io.seekg(size / 2);
          char byte = io.get();
          io.seekp(size / 2);
          io.put(byte ^ 1);
       });
   // The digest itself.
   damage(
       [&](std::fstream& io)
       {
          io.seekp(size - 1);
          io.put('\x5a');
          io.seekp(size - 2);
          io.put('\xa5');
       });
   // Cut short.
   {
      std::filesystem::resize_file(file, size / 2);
      auto result = run();
      CHECK(result.discarded == 1);
      CHECK(result.compiled == 1);
   }
   // An artifact that is intact but stored under another key (a file moved
   // by hand) is not this module's.
   {
      auto moved = file;
      moved.replace_filename(std::string(64, '0') + ".pzam");
      std::filesystem::rename(only(), moved);
      psibase::NativeAotCache      cache{directory};
      psibase::NativeAotCache::Key zero{};
      CHECK_FALSE(cache.load(zero).has_value());
      CHECK(cache.discarded() == 1);
      CHECK(std::filesystem::is_empty(directory));
   }
}

TEST_CASE("A node's compiled modules survive a restart under its database's cache root")
{
   if (!isWasmtime())
      SKIP("counts compiles, which only the wasmtime engine reports");
   TempDirectory data;
   bool          clear = false;
   auto          run   = [&]
   {
      // The database of a node that is stopped and started again. (The
      // fixture's chain is a new one each time; the modules are the node's.)
      psibase::SharedDatabase node{data.path / "node",
                                   {64ull << 20, 64ull << 20, 64ull << 20, 64ull << 20}};
      auto store = std::make_unique<psibase::NativeAotDatabase>(node.cacheRoot());
      if (clear)
         store->clear();
      auto artifacts = std::make_shared<psibase::NativeAotCache>(std::move(store));
      CHECK(artifacts->usable());
      NativeService               fixture{artifacts};
      psibase::TransactionContext transaction{fixture.block, fixture.signedTransaction,
                                              fixture.trace, psibase::DbMode::transaction()};
      CHECK(NativeService::value(fixture.run(transaction)) == 8);
      return fixture.cache.stats();
   };
   auto stats = run();
   CHECK(stats.compiled == 1);
   CHECK(stats.loaded == 0);
   // Restarted: the module is loaded, not compiled.
   stats = run();
   CHECK(stats.compiled == 0);
   CHECK(stats.loaded == 1);
   CHECK(stats.discarded == 0);
   // The cache root is cleared: one compile, and it is back.
   clear = true;
   stats = run();
   CHECK(stats.compiled == 1);
   CHECK(stats.loaded == 0);
   clear = false;
   stats = run();
   CHECK(stats.compiled == 0);
   CHECK(stats.loaded == 1);
}

TEST_CASE("Storing code bills the same with and without a compiled module")
{
   if (!isWasmtime())
      SKIP("only wasmtime compiles where the code is stored");
   using namespace std::chrono;
   TempDirectory artifacts;
   NativeService fixture{artifacts.path / "modules"};
   struct Cost
   {
      nanoseconds   wall, billed;
      std::uint64_t compiled;
   };
   auto store = [&](const std::vector<std::uint8_t>& code, nanoseconds limit = hours(1))
   {
      CodeWriter writer{fixture};
      writer.transaction.setWatchdog(writer.transaction.getBillableTime() + limit);
      const auto billedBefore = writer.transaction.getBillableTime();
      const auto start        = steady_clock::now();
      writer.put(psibase::DbId::native, code);
      Cost cost{steady_clock::now() - start, writer.transaction.getBillableTime() - billedBefore,
                writer.compiled()};
      // A transaction over its limit can start no service.
      CHECK_NOTHROW(fixture.called(writer.transaction, fixture.peer));
      fixture.block.db.kvRemoveRaw(psibase::DbId::native,
                                   psio::encode(psio::key{}, CodeWriter::row(code).key()));
      return cost;
   };
   const auto code = largeModule(6000, 40, 1);
   const auto cold = store(code);
   CHECK(cold.compiled == 1);
   const auto warm = store(code);
   CHECK(warm.compiled == 0);
   INFO("module " << code.size() << " bytes; cold wall " << cold.wall.count() / 1000
                  << " us, billed " << cold.billed.count() / 1000 << " us; warm wall "
                  << warm.wall.count() / 1000 << " us, billed " << warm.billed.count() / 1000
                  << " us");
   // The compile is most of the cold run and none of its bill: what is
   // billed is admission, which the warm run does too.
   CHECK(cold.billed < cold.wall / 2);
   CHECK(warm.billed <= warm.wall);

   // A CPU limit the write passes with the module cached, it passes when it
   // has to compile: several times the warm cost, and less than the compile.
   const auto limit = std::max<nanoseconds>(4 * warm.wall, milliseconds(20));
   const auto other = largeModule(6000, 40, 2);
   const auto first = store(other, limit);
   CHECK(first.compiled == 1);
   CHECK(first.billed < limit);
   if (first.wall <= limit)
      WARN("the compile took " << first.wall.count() / 1000 << " us, within the limit of "
                               << limit.count() / 1000 << " us: nothing was shown");
   const auto again = store(other, limit);
   CHECK(again.compiled == 0);
   CHECK(again.billed < limit);
}

namespace
{
   // Holds every compile from wasm where it is about to start, and records
   // the thread it is on. Declare it before the fixture whose cache it is
   // attached to, and release it before that fixture goes.
   struct CompileGate
   {
      std::mutex                   mutex;
      std::condition_variable      changed;
      bool                         open = true;
      std::vector<std::thread::id> threads;

      void attach(psibase::WasmCache& cache)
      {
         cache.setCompileHook(
             [this](const psibase::Checksum256&)
             {
                std::unique_lock lock{mutex};
                threads.push_back(std::this_thread::get_id());
                changed.notify_all();
                changed.wait(lock, [&] { return open; });
             });
      }
      void close()
      {
         std::lock_guard lock{mutex};
         open = false;
      }
      void release()
      {
         {
            std::lock_guard lock{mutex};
            open = true;
         }
         changed.notify_all();
      }
      // Compiles started so far.
      std::size_t count()
      {
         std::lock_guard lock{mutex};
         return threads.size();
      }
      void awaitStarted(std::size_t compiles)
      {
         std::unique_lock lock{mutex};
         changed.wait(lock, [&] { return threads.size() >= compiles; });
      }
      // Whether any compile since `from` ran on the calling thread.
      bool compiledHere(std::size_t from = 0)
      {
         std::lock_guard lock{mutex};
         return std::find(threads.begin() + from, threads.end(), std::this_thread::get_id()) !=
                threads.end();
      }
   };

   // The fixture's service under another hash: code no cache has seen.
   std::vector<std::uint8_t> otherService(std::uint8_t salt)
   {
      auto code = psizam::read_wasm(PSIBASE_PSIZAM_SERVICE_WASM);
      code.insert(code.end(), {0, 2, 1, salt});  // a custom section named by one byte
      return code;
   }

   // Stores code as a block that was applied before this node started left
   // it: the rows, and no compiled module.
   void storeUncompiled(NativeService&                   fixture,
                        psibase::AccountNumber           account,
                        const std::vector<std::uint8_t>& code)
   {
      auto record = CodeWriter::row(code);
      fixture.block.db.kvPut(record.db, record.key(), record);
      psibase::CodeRow row{.codeNum = account, .codeHash = record.codeHash};
      fixture.block.db.kvPut(row.db, row.key(), row);
   }
}  // namespace

TEST_CASE("A producer's queued transaction never compiles the code it stores")
{
   if (!isWasmtime())
      SKIP("observes compiles, which only the wasmtime engine reports");
   CompileGate   gate;
   TempDirectory artifacts;
   NativeService fixture{artifacts.path / "modules"};
   auto          release = psibase::finally{[&] { gate.release(); }};
   gate.attach(fixture.cache);
   CodeWriter writer{fixture};
   // What ForkDb::pushTransaction sets around a transaction from the queue.
   fixture.block.deferUncompiledCode = true;
   const auto before                 = gate.count();

   // Compiled already, as the speculative run leaves it: stored, no compile.
   const auto cached = largeModule(40, 4, 1);
   fixture.cache.compileAhead(CodeWriter::row(cached).codeHash,
                              {reinterpret_cast<const char*>(cached.data()), cached.size()}, {}, 0);
   const auto compiledBefore = gate.count();
   CHECK(compiledBefore == before + 1);
   CHECK_NOTHROW(writer.put(psibase::DbId::native, cached));
   CHECK(writer.stored(psibase::DbId::native, cached));
   CHECK(gate.count() == compiledBefore);
   CHECK_FALSE(fixture.block.deferral.has_value());

   // Not compiled: not in this block. The write itself goes on (the
   // transaction is discarded when it ends, BlockContext::exec), nothing
   // is compiled on this thread, and a compile is under way on another.
   // What the producer does with a transaction that is marked like this is
   // in "A deferred transaction leaves no result".
   const auto code = largeModule(40, 4, 2);
   const auto hash = CodeWriter::row(code).codeHash;
   const auto next = largeModule(40, 4, 5);
   gate.close();
   CHECK_NOTHROW(writer.put(psibase::DbId::native, code));
   CHECK(fixture.block.deferral.has_value());
   gate.awaitStarted(compiledBefore + 1);
   CHECK_FALSE(gate.compiledHere(compiledBefore));
   // The same transaction stores more code: its compile is started too, so
   // one deferral is enough for all of it.
   CHECK_NOTHROW(writer.put(psibase::DbId::native, next));
   gate.awaitStarted(compiledBefore + 2);
   CHECK_FALSE(gate.compiledHere(compiledBefore));
   // Offered again while the compile is in flight: deferred again, and no
   // further compile is started.
   fixture.block.deferral.reset();
   CHECK_NOTHROW(writer.put(psibase::DbId::native, code));
   CHECK(fixture.block.deferral.has_value());
   CHECK_FALSE(fixture.cache.awaitCompile(hash, {}, 0, std::chrono::nanoseconds(0)));
   CHECK_FALSE(fixture.cache.contains(hash, {}, 0));
   CHECK(gate.count() == compiledBefore + 2);

   // The compile finishes: the next offer is taken, without a compile.
   gate.release();
   fixture.cache.finishCompiles();
   CHECK(fixture.cache.contains(hash, {}, 0));
   fixture.block.deferral.reset();
   CHECK_NOTHROW(writer.put(psibase::DbId::native, code));
   CHECK_NOTHROW(writer.put(psibase::DbId::native, next));
   CHECK_FALSE(fixture.block.deferral.has_value());
   CHECK(writer.stored(psibase::DbId::native, code));
   CHECK(gate.count() == compiledBefore + 2);
   CHECK_FALSE(gate.compiledHere(compiledBefore));
}

TEST_CASE("Code this node's compiler refuses does not keep a producer deferring")
{
   if (!isWasmtime())
      SKIP("the refusal is wasmtime's");
   // The module of "Code the engine's compiler refuses after admission":
   // admitted by the chain, refused by wasmtime's compiler.
   const EntryPoints         entry{0, 0};
   std::vector<std::uint8_t> types{3}, declared{3}, exported{2}, bodies{3};
   types.insert(types.end(), entry.types.begin(), entry.types.end());
   types.insert(types.end(), {0x60, 0, 0});
   declared.insert(declared.end(), entry.functions.begin(), entry.functions.end());
   declared.push_back(2);
   exported.insert(exported.end(), entry.exports.begin(), entry.exports.end());
   bodies.insert(bodies.end(), entry.bodies.begin(), entry.bodies.end());
   bodies.insert(bodies.end(), {8, 0, 0x02, 0x64, 0x70, 0x00, 0x0b, 0x1a, 0x0b});
   auto code = wasmModule({});
   section(code, 1, types);
   section(code, 3, declared);
   section(code, 7, exported);
   section(code, 10, bodies);
   const auto hash = CodeWriter::row(code).codeHash;

   TempDirectory artifacts;
   NativeService fixture{artifacts.path / "modules"};
   CodeWriter    writer{fixture};
   fixture.block.deferUncompiledCode = true;
   CHECK_NOTHROW(writer.put(psibase::DbId::native, code));
   CHECK(fixture.block.deferral.has_value());
   CHECK(fixture.cache.awaitCompile(hash, {}, 0));
   CHECK_FALSE(fixture.cache.contains(hash, {}, 0));
   // The compile ended without a module. The transaction is taken, as it
   // is by a producer on an engine that compiles this code.
   fixture.block.deferral.reset();
   CHECK_NOTHROW(writer.put(psibase::DbId::native, code));
   CHECK_FALSE(fixture.block.deferral.has_value());
   CHECK(writer.stored(psibase::DbId::native, code));
}

TEST_CASE("A producer defers code that was compiled and has since been evicted")
{
   if (!isWasmtime())
      SKIP("observes compiles, which only the wasmtime engine reports");
   // "A compile this producer started has ended and there is no module"
   // does not mean the compiler refused the code: the module may have been
   // compiled and then have left the memory cache and the artifact store.
   // The producer must then defer again, not compile where it stands.
   CompileGate   gate;
   TempDirectory artifacts;
   NativeService fixture{artifacts.path / "modules"};
   auto          release = psibase::finally{[&] { gate.release(); }};
   gate.attach(fixture.cache);
   CodeWriter writer{fixture};
   fixture.block.deferUncompiledCode = true;

   const auto code = largeModule(40, 4, 21);
   const auto hash = CodeWriter::row(code).codeHash;
   // Deferred once; the compile this producer started leaves the module.
   CHECK_NOTHROW(writer.put(psibase::DbId::native, code));
   REQUIRE(fixture.block.deferral.has_value());
   fixture.cache.finishCompiles();
   REQUIRE(fixture.cache.contains(hash, {}, 0));

   // Evicted: from the store, and from memory by more modules than the
   // memory cache holds.
   std::error_code ignored;
   for (const auto& entry : std::filesystem::recursive_directory_iterator(artifacts.path, ignored))
      if (entry.is_regular_file(ignored))
         std::filesystem::remove(entry.path(), ignored);
   for (int i = 0; i < 8; ++i)
   {
      const auto other = largeModule(40, 4, 30 + i);
      fixture.cache.compileAhead(CodeWriter::row(other).codeHash,
                                 {reinterpret_cast<const char*>(other.data()), other.size()}, {},
                                 0);
   }
   for (const auto& entry : std::filesystem::recursive_directory_iterator(artifacts.path, ignored))
      if (entry.is_regular_file(ignored))
         std::filesystem::remove(entry.path(), ignored);
   REQUIRE_FALSE(fixture.cache.contains(hash, {}, 0));

   // Offered again: deferred, and compiled on a compile thread.
   const auto before = gate.count();
   gate.close();
   fixture.block.deferral.reset();
   CHECK_NOTHROW(writer.put(psibase::DbId::native, code));
   CHECK(fixture.block.deferral.has_value());
   gate.awaitStarted(before + 1);
   CHECK_FALSE(gate.compiledHere(before));
   gate.release();
   fixture.cache.finishCompiles();
   CHECK(fixture.cache.contains(hash, {}, 0));
   CHECK(gate.count() == before + 1);
   fixture.block.deferral.reset();
   CHECK_NOTHROW(writer.put(psibase::DbId::native, code));
   CHECK_FALSE(fixture.block.deferral.has_value());
   CHECK(writer.stored(psibase::DbId::native, code));
}

TEST_CASE("A producer's queued transaction never compiles a service it executes")
{
   if (!isWasmtime())
      SKIP("observes compiles, which only the wasmtime engine reports");
   const psibase::AccountNumber account{"vm-cold"};
   const auto                   code = otherService(1);
   const auto                   hash = CodeWriter::row(code).codeHash;
   auto                         request = [&](NativeService& fixture)
   {
      auto result    = fixture.action();
      result.service = account;
      return result;
   };

   CompileGate   gate;
   TempDirectory artifacts;
   NativeService fixture{artifacts.path / "modules"};
   auto          release = psibase::finally{[&] { gate.release(); }};
   gate.attach(fixture.cache);
   storeUncompiled(fixture, account, code);
   fixture.block.deferUncompiledCode = true;
   gate.close();
   {
      psibase::TransactionContext transaction{fixture.block, fixture.signedTransaction,
                                              fixture.trace, psibase::DbMode::transaction()};
      psibase::ActionTrace        trace;
      CHECK_THROWS_AS(transaction.execNonTrxAction(0, request(fixture), trace),
                      psibase::TransactionDeferred);
      CHECK(fixture.block.deferral.has_value());
   }
   gate.awaitStarted(1);
   CHECK_FALSE(gate.compiledHere());
   gate.release();
   CHECK(fixture.cache.awaitCompile(hash, {}, 0));
   {
      psibase::TransactionContext transaction{fixture.block, fixture.signedTransaction,
                                              fixture.trace, psibase::DbMode::transaction()};
      CHECK(CodeWriter::call(fixture, transaction, account) == 8);
   }
   CHECK(gate.count() == 1);

   // What the block itself runs outside queued transactions (callbacks,
   // queries) compiles where it needs the module: there is no later block
   // for it. A callback of the same block, another cold service.
   const psibase::AccountNumber other{"vm-cold2"};
   storeUncompiled(fixture, other, otherService(2));
   {
      psibase::TransactionContext transaction{fixture.block, fixture.signedTransaction,
                                              fixture.trace, psibase::DbMode::callback()};
      CHECK(CodeWriter::call(fixture, transaction, other) == 8);
   }
   CHECK(gate.count() == 2);
   CHECK(gate.compiledHere(1));

   // A node that restarts has the modules stored: nothing is deferred and
   // nothing compiled, the module is loaded where it is needed.
   NativeService restarted{artifacts.path / "modules"};
   storeUncompiled(restarted, account, code);
   restarted.block.deferUncompiledCode = true;
   {
      psibase::TransactionContext transaction{restarted.block, restarted.signedTransaction,
                                              restarted.trace, psibase::DbMode::transaction()};
      CHECK(CodeWriter::call(restarted, transaction, account) == 8);
   }
   CHECK(restarted.cache.stats().compiled == 0);
   CHECK(restarted.cache.stats().loaded == 1);
}

TEST_CASE("A deferred transaction leaves no result and is applied once its code is compiled")
{
   if (!isWasmtime())
      SKIP("observes compiles, which only the wasmtime engine reports");
   // A transaction service that accepts everything: start, called and
   // processTransaction, all empty.
   const EntryPoints         entry{0, 0};
   std::vector<std::uint8_t> types{3}, declared{3}, exported{3}, bodies{3};
   types.insert(types.end(), entry.types.begin(), entry.types.end());
   types.insert(types.end(), {0x60, 0, 0});
   declared.insert(declared.end(), entry.functions.begin(), entry.functions.end());
   declared.push_back(2);
   exported.insert(exported.end(), entry.exports.begin(), entry.exports.end());
   const std::string name = "processTransaction";
   exported.push_back(static_cast<std::uint8_t>(name.size()));
   exported.insert(exported.end(), name.begin(), name.end());
   exported.insert(exported.end(), {0, 2});
   bodies.insert(bodies.end(), entry.bodies.begin(), entry.bodies.end());
   bodies.insert(bodies.end(), {2, 0, 0x0b});
   auto code = wasmModule({});
   section(code, 1, types);
   section(code, 3, declared);
   section(code, 7, exported);
   section(code, 10, bodies);
   const auto hash = CodeWriter::row(code).codeHash;

   psibase::Transaction unsignedTransaction;
   unsignedTransaction.actions.push_back(psibase::Action{});
   psibase::SignedTransaction pushed;
   pushed.transaction = psio::shared_pssz<psibase::Transaction>{unsignedTransaction};

   // What a node that had the module all along records.
   psibase::TransactionTrace              expected;
   std::vector<psibase::SignedTransaction> expectedBlock;
   {
      TempDirectory artifacts;
      NativeService fixture{artifacts.path / "modules"};
      storeUncompiled(fixture, psibase::transactionServiceNum, code);
      fixture.block.active = true;
      fixture.cache.compileAhead(hash, {reinterpret_cast<const char*>(code.data()), code.size()},
                                 {}, 0);
      fixture.block.deferUncompiledCode = true;
      REQUIRE_NOTHROW(
          fixture.block.pushTransaction(psibase::SignedTransaction{pushed}, expected, std::nullopt));
      expectedBlock = fixture.block.current.transactions;
   }

   CompileGate   gate;
   TempDirectory artifacts;
   NativeService fixture{artifacts.path / "modules"};
   auto          release = psibase::finally{[&] { gate.release(); }};
   gate.attach(fixture.cache);
   storeUncompiled(fixture, psibase::transactionServiceNum, code);
   fixture.block.active              = true;
   fixture.block.deferUncompiledCode = true;
   gate.close();
   {
      psibase::TransactionTrace trace;
      auto                      offered = pushed;
      CHECK_THROWS_AS(fixture.block.pushTransaction(std::move(offered), trace, std::nullopt),
                      psibase::TransactionDeferred);
      // No result of any kind, and the transaction is as it was offered.
      CHECK_FALSE(trace.error.has_value());
      CHECK(fixture.block.current.transactions.empty());
      CHECK(fixture.block.transactionBytes == 0);
      CHECK_FALSE(offered.subjectiveData.has_value());
      CHECK(psio::to_pssz(offered) == psio::to_pssz(pushed));
      // The block goes on.
      CHECK(fixture.block.active);
      CHECK_FALSE(fixture.block.deferral.has_value());
   }
   gate.awaitStarted(1);
   CHECK_FALSE(gate.compiledHere());
   gate.release();
   CHECK(fixture.cache.awaitCompile(hash, {}, 0));
   psibase::TransactionTrace trace;
   CHECK_NOTHROW(
       fixture.block.pushTransaction(psibase::SignedTransaction{pushed}, trace, std::nullopt));
   CHECK(gate.count() == 1);
   // What is recorded is what the node that never deferred recorded.
   CHECK_FALSE(trace.error.has_value());
   CHECK(trace.error == expected.error);
   CHECK(trace.actionTraces.size() == expected.actionTraces.size());
   CHECK(psio::to_pssz(fixture.block.current.transactions) == psio::to_pssz(expectedBlock));
}

TEST_CASE("A node applying a block does not wait for a compile where the code is stored")
{
   if (!isWasmtime())
      SKIP("observes compiles, which only the wasmtime engine reports");
   const auto                   code = otherService(3);
   const auto                   hash = CodeWriter::row(code).codeHash;
   const psibase::AccountNumber account{"vm-applied"};

   CompileGate   gate;
   TempDirectory artifacts;
   NativeService fixture{artifacts.path / "modules"};
   auto          release = psibase::finally{[&] { gate.release(); }};
   gate.attach(fixture.cache);
   fixture.block.isProducing = false;
   CodeWriter writer{fixture};
   const auto before = gate.count();
   gate.close();
   // The write returns although the compile cannot finish.
   CHECK_NOTHROW(writer.put(psibase::DbId::native, code));
   CHECK(writer.stored(psibase::DbId::native, code));
   gate.awaitStarted(before + 1);
   CHECK_FALSE(gate.compiledHere(before));
   CHECK_FALSE(fixture.cache.contains(hash, {}, 0));
   CHECK(writer.compiled() == 0);

   // The same block calls the new code: its first execution waits for that
   // compile instead of starting another. The compile is let go from
   // another thread, whenever that happens to be.
   psibase::CodeRow row{.codeNum = account, .codeHash = hash};
   fixture.block.db.kvPut(row.db, row.key(), row);
   std::thread opener{[&]
                      {
                         std::this_thread::sleep_for(std::chrono::milliseconds(50));
                         gate.release();
                      }};
   CHECK(NativeService::value(fixture.called(writer.transaction, account)) == 8);
   opener.join();
   CHECK(gate.count() == before + 1);
   CHECK_FALSE(gate.compiledHere(before));
   CHECK(writer.compiled() == 1);
}

TEST_CASE("A speculative run gives up on a compile that takes too long, and the compile runs on")
{
   if (!isWasmtime())
      SKIP("observes compiles, which only the wasmtime engine reports");
   const auto code = largeModule(40, 4, 3);
   const auto hash = CodeWriter::row(code).codeHash;

   CompileGate   gate;
   TempDirectory artifacts;
   NativeService fixture{artifacts.path / "modules"};
   auto          release = psibase::finally{[&] { gate.release(); }};
   gate.attach(fixture.cache);
   CHECK(fixture.cache.speculativeCompileWait() == std::chrono::seconds(5));
   fixture.cache.setSpeculativeCompileWait(std::chrono::milliseconds(20));
   {
      CodeWriter writer{fixture, psibase::DbMode::speculative()};
      const auto before = gate.count();
      gate.close();
      CHECK_THROWS_WITH(writer.put(psibase::DbId::native, code),
                        Catch::Matchers::ContainsSubstring("still being compiled on this node"));
      CHECK_FALSE(writer.stored(psibase::DbId::native, code));
      CHECK_FALSE(fixture.block.deferral.has_value());
      // The compile is where it was: on its own thread, not stopped.
      gate.awaitStarted(before + 1);
      CHECK_FALSE(gate.compiledHere(before));
      CHECK_FALSE(fixture.cache.contains(hash, {}, 0));
      gate.release();
      CHECK(fixture.cache.awaitCompile(hash, {}, 0));
      CHECK(fixture.cache.contains(hash, {}, 0));
      CHECK(gate.count() == before + 1);
   }
   // The transaction is sent again: its run finds the module.
   CodeWriter writer{fixture, psibase::DbMode::speculative()};
   CHECK_NOTHROW(writer.put(psibase::DbId::native, code));
   CHECK(writer.stored(psibase::DbId::native, code));
   CHECK(writer.compiled() == 0);
   CHECK(writer.transaction.startedCompileTime == std::chrono::nanoseconds(0));
}

TEST_CASE("Speculative runs start no more compiles than the node allows at once")
{
   if (!isWasmtime())
      SKIP("observes compiles, which only the wasmtime engine reports");
   CompileGate   gate;
   TempDirectory artifacts;
   NativeService fixture{artifacts.path / "modules"};
   auto          release = psibase::finally{[&] { gate.release(); }};
   gate.attach(fixture.cache);
   CodeWriter writer{fixture, psibase::DbMode::speculative()};
   fixture.cache.setSpeculativeCompileWait(std::chrono::milliseconds(1));
   const auto before = gate.count();
   gate.close();
   const auto cap = psibase::WasmCache::maxSpeculativeCompiles;
   for (std::uint32_t i = 0; i < cap; ++i)
      CHECK_THROWS_WITH(writer.put(psibase::DbId::native, largeModule(40, 4, 10 + i)),
                        Catch::Matchers::ContainsSubstring("still being compiled on this node"));
   gate.awaitStarted(before + cap);
   const auto beyond = largeModule(40, 4, 10 + cap);
   CHECK_THROWS_WITH(writer.put(psibase::DbId::native, beyond),
                     Catch::Matchers::ContainsSubstring("compiling as many services"));
   CHECK_FALSE(writer.stored(psibase::DbId::native, beyond));
   // Code already being compiled is not a further compile.
   CHECK_THROWS_WITH(writer.put(psibase::DbId::native, largeModule(40, 4, 10)),
                     Catch::Matchers::ContainsSubstring("still being compiled on this node"));
   // A block being applied is not refused: its compile queues.
   CHECK(fixture.cache.compileInBackground(
             CodeWriter::row(beyond).codeHash,
             {reinterpret_cast<const char*>(beyond.data()), beyond.size()}, {}, 0) ==
         psibase::WasmCache::CompileStart::started);
   CHECK(gate.count() == before + cap);

   gate.release();
   fixture.cache.finishCompiles();
   CHECK(gate.count() == before + cap + 1);
   fixture.cache.setSpeculativeCompileWait(std::chrono::seconds(5));
   CHECK_NOTHROW(writer.put(psibase::DbId::native, beyond));
   CHECK(writer.stored(psibase::DbId::native, beyond));
}

TEST_CASE("A speculative run's limit measures its execution, not the compiles it waits for")
{
   if (!isWasmtime())
      SKIP("observes compiles, which only the wasmtime engine reports");
   using namespace std::chrono;
   const auto compileTime = milliseconds(400);
   const auto limit       = milliseconds(100);
   const auto code        = largeModule(40, 4, 4);

   TempDirectory artifacts;
   NativeService fixture{artifacts.path / "modules"};
   std::atomic<bool> slow{false};
   // An injected compile time, several times the run's limit.
   fixture.cache.setCompileHook(
       [&](const psibase::Checksum256&)
       {
          if (slow)
             std::this_thread::sleep_for(compileTime);
       });
   auto loop = [&](psibase::TransactionContext& transaction)
   {
      auto request = fixture.action(2);  // the fixture's endless loop
      psibase::ActionTrace result;
      transaction.execCalledAction(0, request, result);
   };
   {
      CodeWriter writer{fixture, psibase::DbMode::speculative()};
      slow = true;
      writer.transaction.setWatchdog(writer.transaction.getBillableTime() + limit);
      const auto billedBefore = writer.transaction.getBillableTime();
      // The run has already waited for the fixture's own service.
      const auto chargedBefore = writer.transaction.startedCompileTime;
      const auto start         = steady_clock::now();
      CHECK_NOTHROW(writer.put(psibase::DbId::native, code));
      const auto wall    = steady_clock::now() - start;
      const auto billed  = writer.transaction.getBillableTime() - billedBefore;
      const auto charged = writer.transaction.startedCompileTime - chargedBefore;
      slow               = false;
      CHECK(writer.stored(psibase::DbId::native, code));
      // The compile took longer than the whole limit and the run is alive.
      CHECK(wall >= compileTime);
      CHECK(billed < limit);
      CHECK_NOTHROW(fixture.called(writer.transaction, fixture.peer));
      // What the node could charge the submitter: the compile, and nothing
      // of it is in what the transaction is billed.
      CHECK(charged >= compileTime);
      CHECK(charged <= wall);
      // Its own execution is still held to the limit.
      CHECK_THROWS_AS(loop(writer.transaction), psibase::TimeoutException);
   }
   // Someone else submits the same code: the module is there, nothing to
   // charge.
   CodeWriter writer{fixture, psibase::DbMode::speculative()};
   CHECK_NOTHROW(writer.put(psibase::DbId::native, code));
   CHECK(writer.compiled() == 0);
   CHECK(writer.transaction.startedCompileTime == nanoseconds(0));
}

#include "VmLimitsTests.inc"
