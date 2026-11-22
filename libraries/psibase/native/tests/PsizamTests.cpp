#include <bit>
#include <catch2/catch_all.hpp>
#include <cstdio>
#include <cstring>
#include <functional>
#include <psibase/PsizamPolicy.hpp>
#include <psibase/NativeFunctions.hpp>
#include <psibase/ActionContext.hpp>
#include <psibase/TransactionContext.hpp>
#include <psibase/Watchdog.hpp>
#include <psibase/serviceEntry.hpp>
#include <psio/finally.hpp>
#include <psio/fracpack.hpp>
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
         auto cleanup = psio::finally{[&] { ++destructed; }};
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
   CHECK(psio::to_frac(static_cast<const psibase::VMOptions&>(options)) == psio::to_frac(chain));
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
   auto restore = psio::finally{[&] { context._host_trampoline_ptrs = previous; }};
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
   auto restore = psio::finally{[&]
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
   auto                     restore  = psio::finally{[&]
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
      psibase::WasmCache         cache{4};
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

      NativeService()
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
            auto nested = psio::to_frac(
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
                psio::input_stream(reinterpret_cast<const char*>(code.data()), code.size()));
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
      auto key = psio::convert_to_key(psibase::WasmConfigRow::key(table));
      psibase::WasmConfigRow valid;
      auto expected = psio::to_frac(valid);
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
         CHECK_THROWS(host.kvPut(handle, key, psio::to_frac(invalid)));
         auto retained = fixture.block.db.kvGetRaw(psibase::DbId::native, key);
         REQUIRE(retained.has_value());
         CHECK(std::ranges::equal(std::span(retained->pos, retained->end), expected));
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
       psio::shared_view_ptr<psibase::Transaction>{unsignedTransaction},
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
      result.transaction = transaction;
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
