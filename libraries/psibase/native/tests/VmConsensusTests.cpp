// Correctness fixtures only. This target does not report performance results.
#include "VmConsensusArtifact.hpp"
#include "VmConsensusProcess.hpp"

#include <catch2/catch_all.hpp>
#include <algorithm>
#include <array>
#include <bit>
#include <cstring>
#include <iostream>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace
{
   struct Host
   {
      std::vector<std::pair<uint32_t, uint64_t>> effects;
      void record(uint32_t tag, uint64_t bits) { effects.emplace_back(tag, bits); }
      void fail() { throw std::runtime_error("consensus-host-failure"); }
      std::function<uint32_t(uint32_t)> reentry;
      uint32_t reenter(uint32_t value) { return reentry(value); }
   };
   using Functions = psizam::registered_host_functions<Host>;

   void registerHost()
   {
      static const bool registered = []
      {
         Functions::add<&Host::record>("consensus", "record");
         Functions::add<&Host::fail>("consensus", "fail");
         Functions::add<&Host::reenter>("consensus", "reenter");
         return true;
      }();
      (void)registered;
   }

   // Exactly the production JIT2 profile, including asynchronous backtraces.
   struct Jit2Profile : psizam::jit2
   {
      using context = psizam::detail::jit_execution_context<true>;
      static constexpr bool enable_backtrace = true;
   };

   struct Bits
   {
      uint8_t type = 0;
      uint64_t low = 0, high = 0;
      bool operator==(const Bits&) const = default;
   };

   Bits bits(const psizam::detail::operand_stack_elem& value)
   {
      using namespace psizam::detail;
      if (value.is_a<i32_const_t>()) return {psizam::i32, value.to_ui32()};
      if (value.is_a<i64_const_t>()) return {psizam::i64, value.to_ui64()};
      if (value.is_a<f32_const_t>()) return {psizam::f32, value.to_fui32()};
      if (value.is_a<f64_const_t>()) return {psizam::f64, value.to_fui64()};
      if (value.is_a<v128_const_t>())
      {
         auto v = value.to_v128();
         return {psizam::v128, v.low, v.high};
      }
      throw std::runtime_error("unknown consensus return type");
   }

   struct Observation
   {
      std::string trap;
      std::string rawError;
      Bits result;
      int32_t pages = -1;
      std::vector<uint8_t> memory;
      std::vector<Bits> globals;
      std::vector<std::vector<std::pair<uint32_t, uint32_t>>> tables;
      std::vector<std::pair<uint32_t, uint64_t>> effects;
      std::vector<bool> droppedData, droppedElements;
   };

   std::string trapCategory(const std::exception& ex)
   {
      std::string message = ex.what();
      if (dynamic_cast<const psizam::stack_memory_exception*>(&ex)) return "stack";
      if (dynamic_cast<const psizam::wasm_memory_exception*>(&ex)) return "memory";
      if (dynamic_cast<const psizam::wasm_interpreter_exception*>(&ex))
      {
         if (message.find("unreachable") != std::string::npos) return "unreachable";
         if (message.find("stack") != std::string::npos ||
             message.find("call depth") != std::string::npos) return "stack";
         // The native SIGFPE path exposes one arithmetic exception. Keep its
         // exact diagnostic in the report; separate fixtures fix each opcode
         // and its inputs, so one arithmetic case cannot replace another.
         if (message.find("floating point error") != std::string::npos ||
             message.find("divide by zero") != std::string::npos ||
             message.find("overflow") != std::string::npos ||
             message.find("invalid conversion") != std::string::npos ||
             message.find("unrepresentable") != std::string::npos)
            return "arithmetic";
      }
      if (message == "atomic wait requires shared memory") return "private-wait";
      if (message == "call_indirect incorrect function type" ||
          message == "call_indirect out of range" || message == "indirect call type mismatch" ||
          message == "undefined element") return "indirect";
      if (message == "consensus-host-failure") return "host";
      return "unexpected:" + message;
   }

   template <class Profile>
   class Runtime
   {
      using Backend = psizam::backend<Functions, Profile, psibase::NativeVMOptions>;
      psibase::NativeVMOptions options;
      psizam::wasm_allocator memory;
      psizam::wasm_code code;
      Backend backend;
      Host host;
      psizam::detail::stack_manager stack;

      static psizam::wasm_code prepare(psizam::wasm_code code,
                                       const psibase::NativeVMOptions& options)
      {
         registerHost();
         psibase::validateNativeWasm(code, options);
         return code;
      }

     public:
      Runtime(const psizam::wasm_code& wasm, const psibase::NativeVMOptions& options)
          : options(options), code(prepare(wasm, options)), backend(code, nullptr, options)
      {
         backend.set_wasm_allocator(&memory);
         backend.get_context().set_max_call_depth(options.max_stack_bytes);
         backend.initialize(stack, &host);
         host.reentry = [this](uint32_t value)
         {
            auto& context = backend.get_context();
            const auto remaining = context._remaining_call_depth;
            if (remaining < psibase::NativeVMOptions::stack_usage_for_call)
               throw psizam::stack_memory_exception("stack overflow");
            // Model the real ExecutionContext adapter resetting the budget
            // before it re-enters a suspended service on the same context.
            context.set_max_call_depth(remaining - psibase::NativeVMOptions::stack_usage_for_call);
            host.effects.emplace_back(0xfeed, value);
            auto out = context.template execute<psizam::type_converter<Host>>(
                stack, &host, psizam::detail::jit_visitor{context},
                backend.get_module().get_exported_function("reentry_leaf"), value);
            return out->to_ui32();
         };
      }

      Observation snapshot() 
      {
         Observation out;
         auto& context = backend.get_context();
         out.pages = context.current_linear_memory();
         if (out.pages >= 0)
         {
            auto* begin = reinterpret_cast<const uint8_t*>(context.linear_memory());
            out.memory.assign(begin, begin + uint64_t(out.pages) * 65536);
         }
         for (uint32_t table = 0; table < backend.get_module().tables.size(); ++table)
         {
            std::vector<std::pair<uint32_t, uint32_t>> entries;
            for (uint32_t i = 0; i < context.get_table_size(table); ++i)
            {
               const auto& value = context.get_table_base(table)[i];
               entries.emplace_back(value.type, value.index);
            }
            out.tables.push_back(std::move(entries));
         }
         for (uint32_t i = 0; i < backend.get_module().globals.size(); ++i)
         {
            switch (backend.get_module().globals[i].type.content_type)
            {
               case psizam::i32: out.globals.push_back({psizam::i32, uint32_t(context.get_global_i32(i))}); break;
               case psizam::i64: out.globals.push_back({psizam::i64, uint64_t(context.get_global_i64(i))}); break;
               case psizam::f32: out.globals.push_back({psizam::f32, context.get_global_f32(i)}); break;
               case psizam::f64: out.globals.push_back({psizam::f64, context.get_global_f64(i)}); break;
               case psizam::v128:
               {
                  auto v = context.get_global_v128(i);
                  out.globals.push_back({psizam::v128, v.low, v.high});
                  break;
               }
               default: throw std::runtime_error("unknown consensus global type");
            }
         }
         out.effects = host.effects;
         out.droppedData = context.get_dropped_data();
         out.droppedElements = context.get_dropped_elems();
         return out;
      }

      template <class... Args>
      Observation call(std::string_view name, Args... args)
      {
         Bits result;
         std::string trap, rawError;
         try
         {
            auto& context = backend.get_context();
            auto value = context.template execute<psizam::type_converter<Host>>(
                stack, &host, psizam::detail::jit_visitor{context},
                backend.get_module().get_exported_function(name), args...);
            if (value) result = bits(*value);
         }
         catch (const std::exception& ex)
         {
            trap = trapCategory(ex);
            rawError = ex.what();
         }
         // Never swallow snapshot failures, including a partially initialized
         // memory or global array after a trap.
         auto out = snapshot();
         out.result = result;
         out.trap = trap;
         out.rawError = rawError;
         return out;
      }
   };

   std::string hex(const psibase::Checksum256& value)
   {
      std::string out;
      for (auto byte : value)
      {
         out += "0123456789abcdef"[byte >> 4];
         out += "0123456789abcdef"[byte & 15];
      }
      return out;
   }

   auto packBits(const Bits& b) { return std::tuple{b.type, b.low, b.high}; }

   template <class T>
   Bits argumentBits(T value)
   {
      if constexpr (std::is_same_v<T, psizam::v128_t>)
         return {psizam::v128, value.low, value.high};
      else if constexpr (sizeof(T) == 4)
         return {psizam::i32, uint32_t(value)};
      else
         return {psizam::i64, uint64_t(value)};
   }

   struct Transcript
   {
      psibase::Checksum256 digest{};
      size_t steps = 0;
      void append(std::string_view name, const Observation& out,
                  const std::vector<std::tuple<uint8_t, uint64_t, uint64_t>>& arguments = {})
      {
         std::vector<std::tuple<uint8_t, uint64_t, uint64_t>> globals;
         for (auto& b : out.globals) globals.push_back(packBits(b));
         digest = psibase::sha256(std::tuple{
             digest, std::string(name), arguments, out.trap, packBits(out.result), out.pages,
             out.memory, globals, out.tables, out.effects, out.droppedData, out.droppedElements});
         ++steps;
      }
   };

   void equivalent(const Observation& expected, const Observation& actual,
                   std::string_view engine, std::string_view name)
   {
      INFO("engine=" << engine << " function=" << name);
      INFO("reference trap=" << expected.rawError << "; actual trap=" << actual.rawError);
      INFO("reference bits=" << unsigned(expected.result.type) << ':' << std::hex
           << expected.result.high << ':' << expected.result.low << "; actual bits="
           << unsigned(actual.result.type) << ':' << actual.result.high << ':' << actual.result.low);
      REQUIRE(expected.trap.rfind("unexpected:", 0) != 0);
      REQUIRE(actual.trap.rfind("unexpected:", 0) != 0);
      REQUIRE(actual.trap == expected.trap);
      REQUIRE(actual.result == expected.result);
      REQUIRE(actual.pages == expected.pages);
      REQUIRE(actual.memory == expected.memory);
      REQUIRE(actual.globals == expected.globals);
      REQUIRE(actual.tables == expected.tables);
      REQUIRE(actual.effects == expected.effects);
      REQUIRE(actual.droppedData == expected.droppedData);
      REQUIRE(actual.droppedElements == expected.droppedElements);
   }

   class Matrix
   {
      psizam::wasm_code wasm;
      psibase::NativeVMOptions options;
      vm_consensus::ArtifactFile artifact;
      vm_consensus::SavedArtifactScope scope;
      Runtime<psizam::jit_profile> jit1;
      Runtime<Jit2Profile> jit2;
      Runtime<psizam::aot_profile> aot;
      Runtime<vm_consensus::SavedFileProfile> saved;
      Transcript transcript;

     public:
      explicit Matrix(const char* path, std::uint8_t vmVersion = 0)
          : wasm(psizam::read_wasm(path)),
            options(psibase::VMOptions{1024, 2, 3, 65536}, {}, vmVersion),
            artifact(wasm, options), scope(artifact), jit1(wasm, options), jit2(wasm, options),
            aot(wasm, options), saved(wasm, options)
      {
         auto initial = jit1.snapshot();
         equivalent(initial, jit2.snapshot(), "JIT2", "initialize");
         equivalent(initial, aot.snapshot(), "LLVM_AOT", "initialize");
         equivalent(initial, saved.snapshot(), "SAVED_AOT", "initialize");
         transcript.append("initialize", initial);
      }
      ~Matrix()
      {
         std::cout << "{\"verification\":\"vm-consensus\",\"profiles\":[\"JIT1\",\"JIT2\",\"LLVM_AOT\",\"SAVED_AOT\"],\"wasm_sha256\":\""
                   << hex(psibase::sha256(wasm.data(), wasm.size()))
                   << "\",\"policy_wasm_identity\":\"" << hex(artifact.identity)
                   << "\",\"artifact_sha256\":\"" << hex(psibase::sha256(artifact.bytes.data(), artifact.bytes.size()))
                   << "\",\"steps\":" << transcript.steps << ",\"semantic_sha256\":\""
                   << hex(transcript.digest) << "\"}\n";
      }
      template <class... Args>
      Observation call(std::string_view name, Args... args)
      {
         auto result = jit1.call(name, args...);
         equivalent(result, jit2.call(name, args...), "JIT2", name);
         equivalent(result, aot.call(name, args...), "LLVM_AOT", name);
         equivalent(result, saved.call(name, args...), "SAVED_AOT", name);
         REQUIRE(result.trap.empty());
         transcript.append(name, result, {packBits(argumentBits(args))...});
         return result;
      }
      template <class... Args>
      Observation trap(std::string_view name, std::string_view category, Args... args)
      {
         auto result = jit1.call(name, args...);
         equivalent(result, jit2.call(name, args...), "JIT2", name);
         equivalent(result, aot.call(name, args...), "LLVM_AOT", name);
         equivalent(result, saved.call(name, args...), "SAVED_AOT", name);
         REQUIRE(result.trap == category);
         transcript.append(name, result, {packBits(argumentBits(args))...});
         return result;
      }
   };

   constexpr std::array<uint32_t, 14> f32Seeds{
       0, 0x80000000, 0x3f800000, 0xbf800000, 0x3f000000, 0x7f800000,
       0xff800000, 1, 0x007fffff, 0x7f7fffff, 0x7fc12345, 0xffc23456,
       0x7f812345, 0xff812346};
   constexpr std::array<uint64_t, 14> f64Seeds{
       0, 0x8000000000000000ull, 0x3ff0000000000000ull, 0xbff0000000000000ull,
       0x3fe0000000000000ull, 0x7ff0000000000000ull, 0xfff0000000000000ull,
       1, 0x000fffffffffffffull, 0x7fefffffffffffffull, 0x7ff8123456789abcull,
       0xfff823456789abcdull, 0x7ff0123456789abcull, 0xfff0123456789abdull};
}

TEST_CASE("VM consensus scalar FP preserves exact zero and NaN payload bits")
{
   Matrix m(PSIBASE_VM_CONSENSUS_VALUES_WASM);
   for (auto op : {"add", "sub", "mul", "div", "min", "max", "copysign"})
      for (size_t i = 0; i < f32Seeds.size(); ++i)
         for (size_t j = 0; j < f32Seeds.size(); ++j)
         {
            m.call(std::string("f32_") + op + "_bits", f32Seeds[i], f32Seeds[j]);
            m.call(std::string("f64_") + op + "_bits", f64Seeds[i], f64Seeds[j]);
         }
   for (auto op : {"abs", "neg", "sqrt", "ceil", "floor", "trunc", "nearest", "reinterpret"})
      for (size_t i = 0; i < f32Seeds.size(); ++i)
      {
         m.call(std::string("f32_") + op + "_bits", f32Seeds[i]);
         m.call(std::string("f64_") + op + "_bits", f64Seeds[i]);
      }
   for (size_t i = 0; i < f32Seeds.size(); ++i)
   {
      m.call("f32_demote_bits", f64Seeds[i]);
      m.call("f64_promote_bits", f32Seeds[i]);
      m.call("trunc_sat_f32_s", f32Seeds[i]);
      m.call("trunc_sat_f64_s", f64Seeds[i]);
      CHECK(m.call("f32_reinterpret_bits", f32Seeds[i]).result.low == f32Seeds[i]);
      CHECK(m.call("f64_reinterpret_bits", f64Seeds[i]).result.low == f64Seeds[i]);
      CHECK(m.call("f32_abs_bits", f32Seeds[i]).result.low == (f32Seeds[i] & 0x7fffffff));
      CHECK(m.call("f64_neg_bits", f64Seeds[i]).result.low == (f64Seeds[i] ^ 0x8000000000000000ull));
   }
   CHECK(m.call("f32_add_bits", 0x3f800000u, 0x3f800000u).result.low == 0x40000000u);
   CHECK(m.call("f64_add_bits", 0x3ff0000000000000ull, 0x3ff0000000000000ull).result.low == 0x4000000000000000ull);
   CHECK(m.call("f32_min_bits", 0u, 0x80000000u).result.low == 0x80000000u);
   CHECK(m.call("f64_max_bits", 0ull, 0x8000000000000000ull).result.low == 0);
}

TEST_CASE("VM consensus SIMD FP compares every lane bit")
{
   Matrix m(PSIBASE_VM_CONSENSUS_VALUES_WASM);
   std::vector<psizam::v128_t> vectors;
   for (size_t i = 0; i < f32Seeds.size(); ++i)
      vectors.push_back({uint64_t(f32Seeds[i]) | (uint64_t(f32Seeds[(i + 1) % 14]) << 32),
                         uint64_t(f32Seeds[(i + 3) % 14]) | (uint64_t(f32Seeds[(i + 7) % 14]) << 32)});
   for (size_t i = 0; i < f64Seeds.size(); ++i)
      vectors.push_back({f64Seeds[i], f64Seeds[(i + 5) % 14]});
   for (auto prefix : {"f32x4_", "f64x2_"})
   {
      for (auto op : {"add", "sub", "mul", "div", "min", "max", "pmin", "pmax"})
         for (size_t i = 0; i < vectors.size(); ++i)
         {
            INFO("SIMD vector index=" << i << " lhs=" << vectors[i]
                 << " rhs=" << vectors[(i + 9) % vectors.size()]);
            m.call(std::string(prefix) + op, vectors[i], vectors[(i + 9) % vectors.size()]);
         }
      for (auto op : {"abs", "neg", "sqrt", "ceil", "floor", "trunc", "nearest"})
         for (auto value : vectors) m.call(std::string(prefix) + op, value);
   }
   for (auto value : vectors) m.call("simd_trunc_sat", value);
}

TEST_CASE("VM consensus initialization mutation memory and table policy agree")
{
   Matrix m(PSIBASE_VM_CONSENSUS_VALUES_WASM);
   auto out = m.call("pages");
   REQUIRE(out.globals.size() == 5);
   CHECK(out.globals[0].low == 8);
   REQUIRE(out.effects.size() == 1);
   CHECK(out.effects[0] == std::pair<uint32_t, uint64_t>{1, 8});
   CHECK(out.globals[2].low == 0xff812345u);
   CHECK(out.globals[3].low == 0x7ff8123456789abcull);
   constexpr uint32_t single = 0xff812346;
   constexpr uint64_t wide = 0x7ff0123456789abcull;
   out = m.call("mutate", single, wide);
   CHECK(out.result.low == (wide ^ 9));
   CHECK(out.globals[0].low == 9);
   CHECK(out.globals[1].low == wide);
   CHECK(out.globals[2].low == single);
   CHECK(out.globals[3].low == wide);
   uint32_t stored32;
   uint64_t stored64;
   std::memcpy(&stored32, out.memory.data() + 7, 4);
   std::memcpy(&stored64, out.memory.data() + 29, 8);
   CHECK(stored32 == single);
   CHECK(stored64 == wide);
   CHECK(std::all_of(out.memory.begin() + 256, out.memory.begin() + 288,
                     [](auto byte) { return byte == 90; }));
   CHECK(m.call("grow", 1u).result.low == 1);
   out = m.call("grow", 1u);
   CHECK(out.result.low == 0xffffffffu);
   CHECK(out.pages == 2);
   CHECK(std::all_of(out.memory.begin() + 65536, out.memory.end(), [](auto v) { return v == 0; }));
   CHECK(m.call("table_grow", 2u).result.low == 1);
   CHECK(m.call("table_size").result.low == 3);
   CHECK(m.call("table_grow", 1u).result.low == 0xffffffffu);
   CHECK(m.call("indirect", 42u, 2u).result.low == 42);
}

TEST_CASE("VM consensus traps preserve prior state and allow fresh calls")
{
   Matrix m(PSIBASE_VM_CONSENSUS_TRAPS_WASM);
   uint32_t marker = 0;
   for (auto [name, category] : std::array<std::pair<const char*, const char*>, 7>{{
            {"unreachable", "unreachable"}, {"divide_zero", "arithmetic"},
            {"integer_overflow", "arithmetic"}, {"invalid_conversion", "arithmetic"},
            {"memory_oob", "memory"}, {"host_error", "host"}, {"stack_overflow", "stack"}}})
   {
      auto out = m.trap(name, category);
      CHECK(out.globals.at(0).low == ++marker);
      CHECK(out.effects.back().first == marker);
      CHECK(out.memory.at(9) == marker);
      CHECK(m.call("value").result.low == 42);
   }
   for (auto depth : {0u, 1u, 8u, 32u})
      CHECK(m.call("bounded_recursion", depth).result.low == depth + 1);
   // A fresh independent matrix proves cleanup without resetting any engine's
   // stack counter or memory by hand after the preceding failed calls.
   Matrix fresh(PSIBASE_VM_CONSENSUS_TRAPS_WASM);
   CHECK(fresh.call("bounded_recursion", 32u).result.low == 33);
}

namespace
{
   struct EnabledProposals : psibase::NativeVMOptions
   {
      static constexpr bool enable_atomics = true;
      static constexpr bool enable_relaxed_simd = true;
      static constexpr bool enable_tail_calls = true;
      EnabledProposals() : NativeVMOptions({}) {}
   };
   template <class Profile>
   void proposalPolicy(const psizam::wasm_code& input, bool enabled)
   {
      auto code = input;
      using Backend = psizam::backend<std::nullptr_t, Profile, psibase::NativeVMOptions>;
      if (enabled)
         REQUIRE_NOTHROW(Backend(code, nullptr, psibase::NativeVMOptions({})));
      else
         REQUIRE_THROWS_AS(Backend(code, nullptr, psibase::NativeVMOptions({})), psizam::wasm_parse_exception);
   }
}

TEST_CASE("VM consensus applies the same current proposal policy")
{
   // These flags are the actual selected policy, not a permanent decision to
   // exclude proposals. An enabled policy must admit the same valid controls.
   for (auto [path, enabled] : std::array<std::pair<const char*, bool>, 3>{{
            {PSIBASE_VM_CONSENSUS_ATOMICS_WASM, psibase::NativeVMOptions::enable_atomics},
            {PSIBASE_VM_CONSENSUS_RELAXED_WASM, psibase::NativeVMOptions::enable_relaxed_simd},
            {PSIBASE_VM_CONSENSUS_TAIL_WASM, psibase::NativeVMOptions::enable_tail_calls}}})
   {
      INFO("proposal module=" << path);
      auto code = psizam::read_wasm(path);
      using Validator = psizam::backend<std::nullptr_t, psizam::null_backend, EnabledProposals>;
      REQUIRE_NOTHROW(Validator(code, nullptr, EnabledProposals{}));
      proposalPolicy<psizam::jit_profile>(code, enabled);
      proposalPolicy<Jit2Profile>(code, enabled);
      proposalPolicy<psizam::aot_profile>(code, enabled);
   }
}

TEST_CASE("VM saved AOT rejects a different Wasm or chain policy identity")
{
   auto code = psizam::read_wasm(PSIBASE_VM_CONSENSUS_VALUES_WASM);
   psibase::NativeVMOptions options(psibase::VMOptions{1024, 2, 3, 65536});
   vm_consensus::ArtifactFile artifact(code, options);
   auto wrongIdentity = artifact.identity;
   wrongIdentity[0] ^= 1;
   CHECK_THROWS(psizam::load_native_aot(artifact.bytes, nullptr, wrongIdentity, code));
   auto otherWasm = code;
   otherWasm.back() ^= 1;
   CHECK_THROWS(psizam::load_native_aot(artifact.bytes, nullptr, artifact.identity, otherWasm));
   auto otherPolicy = psibase::NativeVMOptions(psibase::VMOptions{1024, 1, 3, 65536});
   auto otherIdentity = vm_consensus::artifactIdentity(code, otherPolicy);
   CHECK(otherIdentity != artifact.identity);
   CHECK_THROWS(psizam::load_native_aot(artifact.bytes, nullptr, otherIdentity, code));
}

namespace
{
   psibase::Checksum256 savedSequence(Runtime<vm_consensus::SavedFileProfile>& runtime)
   {
      Transcript transcript;
      transcript.append("initialize", runtime.snapshot());
      auto call = [&]<class... Args>(std::string_view name, Args... args)
      {
         auto out = runtime.call(name, args...);
         REQUIRE(out.trap.empty());
         transcript.append(name, out, {packBits(argumentBits(args))...});
         return out;
      };
      CHECK(call("f32_reinterpret_bits", 0xff812345u).result.low == 0xff812345u);
      CHECK(call("f64_neg_bits", 0x7ff0123456789abcull).result.low == 0xfff0123456789abcull);
      CHECK(call("f32_min_bits", 0u, 0x80000000u).result.low == 0x80000000u);
      call("f32x4_add", psizam::v128_t{0x8000000000000000ull, 0x00000001bf800000ull},
           psizam::v128_t{0x7fc123457f7fffffull, 0x3f8000007f812345ull});
      CHECK(call("mutate", 0xff812346u, 0x7ff0123456789abcull).globals.at(0).low == 9);
      CHECK(call("grow", 1u).result.low == 1);
      CHECK(call("grow", 1u).result.low == 0xffffffffu);
      CHECK(call("pages").result.low == 2);
      return transcript.digest;
   }
}

TEST_CASE("VM saved AOT survives an isolated process reload")
{
   auto code = psizam::read_wasm(PSIBASE_VM_CONSENSUS_VALUES_WASM);
   psibase::NativeVMOptions options(psibase::VMOptions{1024, 2, 3, 65536});
   vm_consensus::ArtifactFile artifact(code, options);
   vm_consensus::SavedArtifactScope scope(artifact);
   Runtime<vm_consensus::SavedFileProfile> parent(code, options);
   const auto expected = savedSequence(parent);
   REQUIRE_NOTHROW(vm_consensus::isolatedSavedReload(artifact, hex(expected)));
}

TEST_CASE("VM consensus isolated saved-only child", "[.vm-consensus-child]")
{
   // This case is selected by name only by the parent, never by normal CTest.
   const char* path = std::getenv("PSIBASE_VM_CONSENSUS_CHILD_ARTIFACT");
   const char* expected = std::getenv("PSIBASE_VM_CONSENSUS_CHILD_EXPECTED");
   REQUIRE(path != nullptr);
   REQUIRE(expected != nullptr);
   auto code = psizam::read_wasm(PSIBASE_VM_CONSENSUS_VALUES_WASM);
   psibase::NativeVMOptions options(psibase::VMOptions{1024, 2, 3, 65536});
   vm_consensus::ArtifactFile artifact{std::filesystem::path(path)};
   vm_consensus::SavedArtifactScope scope(artifact);
   // This concrete parser only calls load_native_aot on the parent's file.
   // There is no compilation/save_native_aot call on the child path.
   Runtime<vm_consensus::SavedFileProfile> child(code, options);
   const auto actual = savedSequence(child);
   CHECK(hex(actual) == expected);
   std::cout << "{\"verification\":\"saved-only-reload\",\"semantic_sha256\":\""
             << hex(actual) << "\"}\n";
}

#include "VmConsensusRelaxedCases.inc"

#include "VmConsensusAtomicCases.inc"
#include "VmConsensusTableCases.inc"

TEST_CASE("VM same-context host reentry restores the suspended caller budget")
{
   Matrix m(PSIBASE_VM_CONSENSUS_REENTRY_WASM);
   auto out = m.call("repeat_reentry", 300u);
   CHECK(out.result.low == 300);
   REQUIRE(out.effects.size() == 300);
   CHECK(out.effects.back() == std::pair<uint32_t, uint64_t>{0xfeed, 299});
}
