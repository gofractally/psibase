#pragma once

#include <filesystem>
#include <psibase/block.hpp>
#include <psibase/storage.hpp>
#include <psizam/config.hpp>
#include <psizam/options.hpp>
#include <span>
#include <string_view>
#include <array>
#include <memory>
#include <optional>
#include <vector>

namespace psizam
{
   struct module;
}

namespace psibase
{
   class NativeAotCache;
   /// PSIBASE_NATIVE_AOT_CACHE when set, otherwise `fallback`.
   std::filesystem::path nativeAotCachePath(const std::filesystem::path& fallback);
   /// The cache for a process that configures none: PSIBASE_NATIVE_AOT_CACHE,
   /// else one shared by the user's processes.
   std::shared_ptr<NativeAotCache> nativeAotCacheFromEnvironment();
   /// The cache of a node: records under `root`, the root of the node's
   /// database that is no part of the chain (NativeAotDatabase), holding at
   /// most PSIBASE_NATIVE_AOT_CACHE_MB MiB if that is set. Starting the node
   /// with PSIBASE_NATIVE_AOT_CACHE_CLEAR=1 empties that root first: every
   /// module is then compiled again when it is next needed, and nothing else
   /// changes. If PSIBASE_NATIVE_AOT_CACHE is set it names a directory to use
   /// instead, as for every other program: that is how the nodes of a test
   /// share what one of them compiled, which a root of one node's database
   /// cannot.
   std::shared_ptr<NativeAotCache> nodeNativeAotCache(storage::cache_root root);

   /// The float profile a code version (CodeRow::vmVersion) executes under:
   /// 0 is the strict WebAssembly deterministic profile, 1 the deterministic
   /// performance profile (fused relaxed_madd). A version this node does not
   /// know has none and its code is refused, never run under another policy.
   std::optional<psizam::float_profile> nativeFloatProfile(std::uint8_t vmVersion);

   /// The hard ceiling of one member of VMOptions: the lowest absolute limit
   /// of any supported engine for it (gofractally/psibase#2262). A
   /// configuration row with a member above its ceiling is refused
   /// (checkVMOptionCeilings, from verifyWasmConfigRow).
   struct VMOptionCeiling
   {
      std::string_view          name;
      std::uint32_t VMOptions::*member;
      std::uint32_t             ceiling;
      /// Set below a limit that is to be lifted; the string names the
      /// issue. Empty otherwise.
      std::string_view temporary;
      /// The engine and source that set the ceiling.
      std::string_view source;
   };
#define PSIBASE_VM_CEILING(member, ceiling, temporary, source) \
   VMOptionCeiling { #member, &VMOptions::member, ceiling, temporary, source }
   // Sources: "WP" is the wasmparser crate wasmtime validates with (0.263.0;
   // its constants are private and not configurable, so each ceiling is at
   // or below the stock constant); "WT" the wasmtime fork; "PZ" psizam
   // (external/psizam/include/psizam); "survey" the measurements recorded on
   // gofractally/psibase#2262.
   //
   // LLVM AOT is a supported engine: what it refuses is a ceiling, not a
   // defect to wait for (max_type_section_elements, max_block_params).
   //
   // JIT2 is experimental and sets no ceiling by itself. It MUST NOT BE USED
   // WHERE RESULTS MATTER until gofractally/psizam#3 is fixed: it
   // miscompiles a function with more than 32,767 spill slots, which no
   // ceiling here rules out (see max_func_local_bytes). psitest still runs
   // test modules on it: gofractally/psibase#2231.
   inline constexpr std::array<VMOptionCeiling, vmOptionCount> vmOptionCeilings = {{
       PSIBASE_VM_CEILING(max_mutable_global_bytes, 1'600'000, "",
           "no engine limit below 2^32; 16 bytes for each of the 100,000 globals allowed"),
       PSIBASE_VM_CEILING(max_pages, 65'536, "",
           "wasm32 itself; PZ detail/parser.hpp:752, WP validator/core.rs:803"),
       PSIBASE_VM_CEILING(max_table_elements, 1'048'576, "",
           "no engine limit below 2^32; chosen. A slot of the wasmtime adapter's instance pool "
           "holds a table of 65,536 elements (ExecutionContextWasmtime.cpp pool_table_elements); "
           "a module with a larger table is compiled and run on the engine without a pool "
           "(gofractally/psibase#2272), so the pool does not set this"),
       PSIBASE_VM_CEILING(max_stack_bytes, 16 * 1024 * 1024, "",
           "the wasmtime adapter: 16 native bytes per budget byte in a 256 MiB native stack, "
           "ExecutionContextWasmtime.cpp nativeStackBytes / nativeBytesPerBudget"),
       PSIBASE_VM_CEILING(max_module_bytes, 15 * 1024 * 1024, "",
           "storage: the largest value a row may have, verifyConfigRow maxValueSize"),
       PSIBASE_VM_CEILING(max_type_section_elements, 60'000, "",
           "psizam LLVM AOT and JIT2 (gofractally/psizam#4): LLVM AOT refuses a module of 70,002 "
           "types when it compiles it (\"invalid typed guest call\", arm64), and JIT2 packs a "
           "call_indirect type index in 16 bits (PZ detail/ir_writer.hpp:1666); 60,002 types "
           "measured good. WP MAX_WASM_TYPES is 1,000,000, validator.rs:739"),
       PSIBASE_VM_CEILING(max_import_section_elements, 10'000, "",
           "WP MAX_WASM_IMPORTS 1,000,000, validator.rs:767; kept low so that max_type_size is "
           "the only bound on the size of imports and exports"),
       PSIBASE_VM_CEILING(max_function_section_elements, 100'000, "",
           "WP MAX_WASM_FUNCTIONS 1,000,000, validator.rs:796; wasmtime needed 5.97 GB to "
           "compile 1,000,000 empty functions (survey B5), 0.75 GB at this ceiling"),
       PSIBASE_VM_CEILING(max_table_section_elements, 1, "",
           "the node gives a service one table: wasmtime StoreLimits tables = 1, PZ shim "
           "lib.rs:669; the host interface addresses one table"),
       PSIBASE_VM_CEILING(max_memory_section_elements, 1, "",
           "multi-memory is off on wasmtime; the host interface addresses one memory"),
       PSIBASE_VM_CEILING(max_global_section_elements, 100'000, "",
           "WP MAX_WASM_GLOBALS 1,000,000, validator.rs:889; chosen, as "
           "max_function_section_elements. A slot of the wasmtime adapter's instance pool holds "
           "an instance of 4 MiB (PZ wasmtime/shim/src/lib.rs max_core_instance_size; measured: "
           "32 bytes per function, 32 more per import, 16 per global); a module that needs more "
           "is compiled and run on the engine without a pool (gofractally/psibase#2272), so the "
           "pool does not set this"),
       PSIBASE_VM_CEILING(max_export_section_elements, 10'000, "",
           "WP MAX_WASM_EXPORTS 1,000,000, validator.rs:911; see max_import_section_elements"),
       PSIBASE_VM_CEILING(max_element_section_elements, 100'000, "",
           "WP MAX_WASM_ELEMENT_SEGMENTS 100,000, validator.rs:953"),
       PSIBASE_VM_CEILING(max_data_section_elements, 100'000, "",
           "WP MAX_WASM_DATA_SEGMENTS 100,000, validator.rs:984"),
       PSIBASE_VM_CEILING(max_element_segment_elements, 10'000'000, "",
           "WP MAX_WASM_TABLE_ENTRIES 10,000,000, validator/core.rs:157"),
       PSIBASE_VM_CEILING(max_data_segment_bytes, 15 * 1024 * 1024, "",
           "no engine limit; a segment is inside the module (max_module_bytes)"),
       PSIBASE_VM_CEILING(max_symbol_bytes, 100'000, "",
           "WP MAX_WASM_STRING_SIZE 100,000, binary_reader.rs:465; for a custom section's name "
           "applied by the shim's own pass, PZ wasmtime/shim/src/stack_meter.rs:43"),
       PSIBASE_VM_CEILING(max_type_size, 999'999, "",
           "WP MAX_WASM_TYPE_SIZE: the size must stay below 1,000,000, validator.rs:88"),
       PSIBASE_VM_CEILING(max_function_params, 1'000, "",
           "WP MAX_WASM_FUNCTION_PARAMS 1,000, readers/core/types.rs:2207"),
       PSIBASE_VM_CEILING(max_function_results, 16, "",
           "psizam's fixed arrays of 16 results, PZ detail/parser.hpp:827"),
       PSIBASE_VM_CEILING(max_function_locals, 50'000, "",
           "WP MAX_WASM_FUNCTION_LOCALS 50,000, parameters included, validator/operators.rs:4803; "
           "Cranelift block parameters are 16-bit, WT cranelift/codegen/src/ir/dfg.rs:695"),
       PSIBASE_VM_CEILING(max_func_local_bytes, 16 * 1024 * 1024, "",
           "the stack budget: a call takes these bytes (plus 16) from max_stack_bytes, whose "
           "ceiling is 16 MiB, so a function with more could never be called. No ceiling is set "
           "for gofractally/psizam#3 (JIT2 miscompiles a function with more than 32,767 spill "
           "slots): JIT2 alone has the defect (LLVM AOT returns correct values on the probe "
           "modules), JIT2 is experimental, and a ceiling here would not close it: it depends on "
           "the spilled intervals of the whole function, not on the values live at once"),
       PSIBASE_VM_CEILING(max_code_bytes, 7'654'321, "",
           "WP MAX_WASM_FUNCTION_SIZE 7,654,321, validator.rs:1033"),
       PSIBASE_VM_CEILING(max_br_table_elements, 65'520, "",
           "Cranelift translator MAX_BR_TABLE_TARGETS 65,520, WT crates/cranelift/src/lib.rs:64. "
           "Also below gofractally/psizam#5 (JIT1 aarch64 refuses a br_table between 100,000 and "
           "1,000,000 targets)"),
       PSIBASE_VM_CEILING(max_nested_structures, 100'000, "",
           "no engine limit found; 1,000,000 nested blocks cost 0.3 to 1.25 GB to compile "
           "(survey row 25)"),
       PSIBASE_VM_CEILING(max_block_params, 16, "",
           "psizam LLVM AOT and JIT2 (gofractally/psizam#5): LLVM AOT refuses an if with 17 "
           "block parameters when it compiles it (\"IR virtual stack underflow\", arm64), and "
           "JIT2 holds 16 (PZ detail/jit_ir.hpp:491). WP MAX_WASM_FUNCTION_PARAMS is 1,000"),
   }};
#undef PSIBASE_VM_CEILING
   // Every member of VMOptions has exactly one entry: the table has one
   // entry per member (its size is vmOptionCount) and no two entries name
   // the same member. Adding a member without a ceiling does not compile.
   static_assert([] {
      for (std::size_t i = 0; i < vmOptionCeilings.size(); ++i)
         for (std::size_t j = i + 1; j < vmOptionCeilings.size(); ++j)
            if (vmOptionCeilings[i].member == vmOptionCeilings[j].member)
               return false;
      return true;
   }(), "two ceilings name the same member of VMOptions, so a member has none");
   // No default is above its ceiling.
   static_assert([] {
      for (const auto& entry : vmOptionCeilings)
         if (VMOptions{}.*entry.member > entry.ceiling)
            return false;
      return true;
   }(), "a default of VMOptions is above its ceiling");

   /// Throws std::runtime_error naming the member and its ceiling if a member
   /// of `options` is above its ceiling.
   void checkVMOptionCeilings(const VMOptions& options);
   /// Every member at its ceiling.
   VMOptions vmOptionsAtCeiling();

   // The proposal set, in one place. Admission accepts exactly this, and the
   // wasmtime adapter enables exactly this (ExecutionContextWasmtime.cpp,
   // engineOptions: simd, relaxed_simd, bulk_memory, sign_extension,
   // saturating_float_to_int, reference_types, multi_value, threads; mutable
   // globals, floats and wide arithmetic come with the engine's base set).
   //
   //   on:  mutable globals, sign extension, saturating float-to-int,
   //        multi-value (results and block parameters limited by VMOptions),
   //        bulk memory, reference types (funcref and externref values, one
   //        funcref table), SIMD, relaxed SIMD (deterministic; multiply-add
   //        per the float profile), atomics instructions (no shared memory),
   //        wide arithmetic
   //   off: extended constant expressions (gofractally/psibase#2266), tail
   //        calls, exception handling (the legacy try and the exnref type
   //        included), multi-memory, memory64, typed function references,
   //        GC (with it, global.get of a global the module defines in a
   //        constant expression), stack switching, custom page sizes,
   //        components
   //
   // psizam's parser has a switch for most of these; the constants below are
   // those switches. Typed function references are refused by its switch
   // (enable_typed_references, gofractally/psizam#6) wherever the parser
   // reads a reference type or a heap type: block types, table and element
   // declarations, ref.null. A constant expression that reads a global the
   // module defines is refused by enable_const_defined_globals
   // (gofractally/psizam#7). It has no switch for extended constant
   // expressions: validateNativeWasm refuses them.
   struct NativeVMOptions : VMOptions
   {
      static constexpr auto          fp                          = psizam::fp_mode::softfloat;
      static constexpr auto          memory_mode                 = psizam::mem_safety::guarded;
      static constexpr auto          checked_kind                = psizam::checked_mode::strict;
      static constexpr bool          gas_metering                = false;
      static constexpr bool          limit_table_growth          = true;
      static constexpr bool          defer_start                 = true;
      static constexpr bool          enable_exception_handling   = false;
      static constexpr bool          enable_atomics              = true;
      static constexpr bool          enable_relaxed_simd         = true;
      static constexpr bool          enable_tail_calls           = false;
      static constexpr bool          enable_sign_ext             = true;
      static constexpr bool          enable_nontrapping_fptoint  = true;
      static constexpr bool          enable_typed_references     = false;
      static constexpr bool          enable_const_defined_globals = false;
      // Not a parser switch: enforced by validateNativeWasm.
      static constexpr bool          enable_extended_const       = false;
      // Incoming arguments remain live across normal and tail calls. Count
      // their storage in the same deterministic logical budget on every engine.
      static constexpr auto max_func_local_bytes_flags =
          psizam::max_func_local_bytes_flags_t::params |
          psizam::max_func_local_bytes_flags_t::locals |
          psizam::max_func_local_bytes_flags_t::stack;

      // Set from the executing code's version; every engine and the artifact
      // identity take it from here.
      psizam::float_profile float_profile = psizam::float_profile::strict;

      std::shared_ptr<NativeAotCache> nativeArtifacts;
      // Diagnostic mode used to prove a warm run needs no compiler fallback.
      bool native_aot_cache_only = false;

      explicit NativeVMOptions(const VMOptions& options,
                               std::shared_ptr<NativeAotCache> artifacts = {},
                               std::uint8_t vmVersion = 0);
      std::array<std::uint8_t, 32> native_aot_identity(
          std::span<const std::uint8_t> wasm, std::uint32_t maximumFunctionBytes,
          psizam::max_func_local_bytes_flags_t components,
          bool backtrace, bool byteStack) const;
      std::vector<char> load_native_aot(const std::array<std::uint8_t, 32>& identity) const;
      void store_native_aot(const std::array<std::uint8_t, 32>& identity,
                            std::span<const char> artifact) const noexcept;
   };

   // The first pass of admission, over the module's declarations: every limit
   // of VMOptions that can be decided without decoding instructions, the
   // resource and import models the node's host interface does not implement,
   // and the proposals that are off and that psizam's parser has no switch
   // for. It runs before the general parser allocates or compiles anything.
   // Each refusal names the member of VMOptions that was exceeded.
   // What it leaves to the parser pass of admitNativeWasm:
   // max_mutable_global_bytes, max_func_local_bytes, max_br_table_elements,
   // max_nested_structures and max_block_params.
   void validateNativeWasm(std::span<const std::uint8_t> code, const NativeVMOptions& options);

   /// The functions the node calls a service through, as the module exports
   /// them: each is the wasm function index (in the function index space, so
   /// imported functions count) of the export of that name, or nothing if
   /// the module has no such export.
   ///
   /// Part of the admission rule: an export with one of these names must be
   /// a function with exactly this signature, or the module is refused.
   ///
   ///    start:              (i64) -> ()       this service
   ///    called:             (i64, i64) -> ()  this service, sender
   ///    serve:              () -> ()
   ///    processTransaction: () -> ()
   ///
   /// start and called are required: a module without either is refused
   /// (gofractally/psibase#2261). serve and processTransaction are optional:
   /// a service without one fails when the node tries to call it.
   struct NativeEntryPoints
   {
      std::optional<std::uint32_t> start;
      std::optional<std::uint32_t> called;
      std::optional<std::uint32_t> serve;
      std::optional<std::uint32_t> processTransaction;
      friend bool operator==(const NativeEntryPoints&, const NativeEntryPoints&) = default;
   };

   /// What admission learns about a module it admits.
   struct NativeAdmission
   {
      /// psizam's stack byte cost of each defined function, in order (what
      /// wasmtime's metered compile needs).
      std::vector<std::uint32_t> costs;
      NativeEntryPoints          entryPoints;
   };

   /// Admission without the rules for a service (imports, entry points):
   /// validateNativeWasm and psizam's parser and validator under
   /// NativeVMOptions, with every limit of VMOptions. Returns the stack byte
   /// cost of each defined function. What tools that probe the limits use.
   std::vector<std::uint32_t> admitNativeModule(std::span<const std::uint8_t> code,
                                                const VMOptions&              options,
                                                std::uint8_t                  vmVersion = 0);

   /// The entry points of a module psizam has parsed, checked as above.
   /// admitNativeWasm does this; an engine that parses the module itself
   /// calls it on its own parse. Throws std::runtime_error with the reason.
   NativeEntryPoints nativeEntryPoints(const psizam::module& module);

   /// The chain's admission rule for service code, the same on every engine:
   /// the version names a float profile, validateNativeWasm, psizam's parser
   /// and validator under NativeVMOptions, and every import is a host
   /// function of NativeHostFunctions.hpp with that function's signature, and
   /// it exports start and called, and every entry point it exports has its
   /// fixed signature (NativeEntryPoints). It
   /// reads nothing but its arguments and that fixed table, so every node
   /// decides alike. It runs when a code row is
   /// written (failure aborts the transaction) and again before an engine
   /// compiles the code (the limits may have changed since it was stored).
   ///
   /// Not covered: limits of an engine's own compiler. Those surface when the
   /// code is first executed; a compiler that refuses admitted code is a
   /// fault of that node's engine, never a property of the transaction.
   ///
   /// Throws std::runtime_error with the reason.
   NativeAdmission admitNativeWasm(std::span<const std::uint8_t> code,
                                   const VMOptions&              options,
                                   std::uint8_t                  vmVersion);

}  // namespace psibase
