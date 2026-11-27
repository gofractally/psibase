#include <algorithm>
#include <limits>
#include <psibase/PsizamPolicy.hpp>
#include <psibase/NativeAotCache.hpp>
#include <psibase/NativeFunctions.hpp>
#include <psibase/NativeHostFunctions.hpp>
#include <psibase/crypto.hpp>
#include <cstdlib>
#include <filesystem>
#include <tuple>
#include <unistd.h>
#if defined(PSIBASE_VM_LLVM_AOT)
#include <psizam/native_artifact.hpp>
#include "psibase-native-aot-host.hpp"
#endif
#include <psizam/wasmtime_admission.hpp>
#include <stdexcept>

namespace psibase
{
   namespace
   {
      // A process that names no cache shares one per user. An artifact is
      // keyed by the module, every option that shapes its code, and the
      // compiler build, so any process may reuse what another compiled.
      // Without this each test process and each test node compiled the same
      // services again, seconds per service.
      std::filesystem::path userCacheDirectory()
      {
         const char* base = std::getenv("XDG_CACHE_HOME");
         if (base && *base == '/')
            return std::filesystem::path(base) / "psibase" / "native-aot";
         const char* home = std::getenv("HOME");
         if (home && *home == '/')
            return std::filesystem::path(home) / ".cache" / "psibase" / "native-aot";
         return {};
      }

      // Used only when the user has no cache directory: private to the
      // process and removed when it exits.
      std::shared_ptr<NativeAotCache> processNativeAotCache()
      {
         struct Temporary
         {
            std::filesystem::path           path;
            std::shared_ptr<NativeAotCache> cache;
            Temporary()
            {
               std::error_code ignored;
               auto pattern =
                   (std::filesystem::temp_directory_path(ignored) / "psibase-native-aot-XXXXXX")
                       .string();
               if (!ignored && ::mkdtemp(pattern.data()))
               {
                  path  = pattern;
                  cache = std::make_shared<NativeAotCache>(path);
               }
            }
            ~Temporary()
            {
               cache.reset();
               std::error_code ignored;
               if (!path.empty())
                  std::filesystem::remove_all(path, ignored);
            }
         };
         static Temporary temporary;
         return temporary.cache;
      }
   }  // namespace

   std::filesystem::path nativeAotCachePath(const std::filesystem::path& fallback)
   {
      if (const char* path = std::getenv("PSIBASE_NATIVE_AOT_CACHE"); path && *path)
         return path;
      return fallback;
   }

   std::shared_ptr<NativeAotCache> nativeAotCacheFromEnvironment()
   {
      if (auto path = nativeAotCachePath(userCacheDirectory()); !path.empty())
         if (auto cache = std::make_shared<NativeAotCache>(path); cache->usable())
            return cache;
      return processNativeAotCache();
   }

   std::shared_ptr<NativeAotCache> nodeNativeAotCache(storage::cache_root root)
   {
      std::uint64_t maxBytes = NativeAotDatabase::defaultMaxBytes;
      if (const char* text = std::getenv("PSIBASE_NATIVE_AOT_CACHE_MB"); text && *text)
         maxBytes = std::strtoull(text, nullptr, 10) << 20;
      auto store = std::make_unique<NativeAotDatabase>(std::move(root), maxBytes);
      // Once per process: a node that restarts in place keeps what it has
      // compiled since.
      static bool cleared = false;
      if (const char* clear = std::getenv("PSIBASE_NATIVE_AOT_CACHE_CLEAR");
          clear && std::string_view(clear) == "1" && !cleared)
      {
         cleared = true;
         store->clear();
      }
      if (auto path = nativeAotCachePath({}); !path.empty())
         return std::make_shared<NativeAotCache>(path);
      auto cache = std::make_shared<NativeAotCache>(std::move(store));
      // A read-only database has no cache root to write; the node still keeps
      // what it compiles, where a process that configures nothing does.
      return cache->usable() ? cache : nativeAotCacheFromEnvironment();
   }

   std::optional<psizam::float_profile> nativeFloatProfile(std::uint8_t vmVersion)
   {
      switch (vmVersion)
      {
         case 0:
            return psizam::float_profile::strict;
         case 1:
            return psizam::float_profile::performance;
         default:
            return std::nullopt;
      }
   }

   NativeVMOptions::NativeVMOptions(const VMOptions& options,
                                    std::shared_ptr<NativeAotCache> artifacts,
                                    std::uint8_t vmVersion)
       : VMOptions(options), nativeArtifacts(std::move(artifacts))
   {
      auto profile = nativeFloatProfile(vmVersion);
      if (!profile)
         throw std::runtime_error("vmVersion is not supported");
      float_profile = *profile;
      const char* only = std::getenv("PSIBASE_NATIVE_AOT_CACHE_ONLY");
      native_aot_cache_only = only && std::string_view(only) == "1";
      if (max_pages > 65536)
         throw std::runtime_error("native WASM policy exceeds memory32 page limit");
      if (max_stack_bytes > std::numeric_limits<std::int32_t>::max())
         throw std::runtime_error("native WASM stack policy exceeds signed code-offset limit");
   }

   std::array<std::uint8_t, 32> NativeVMOptions::native_aot_identity(
       std::span<const std::uint8_t> wasm, std::uint32_t maximumFunctionBytes,
       psizam::max_func_local_bytes_flags_t components, bool backtrace, bool byteStack) const
   {
#if defined(PSIBASE_VM_LLVM_AOT)
      return sha256(std::tuple{
          std::string("psibase-saved-native-aot-v2"), sha256(wasm.data(), wasm.size()),
          static_cast<const VMOptions&>(*this), maximumFunctionBytes, std::uint8_t(components),
          std::uint8_t(fp), std::uint8_t(float_profile), std::uint8_t(memory_mode),
          std::uint8_t(checked_kind),
          gas_metering, limit_table_growth, defer_start, enable_exception_handling,
          enable_atomics, enable_relaxed_simd, enable_tail_calls, enable_simd,
          enable_bulk_memory, stack_usage_for_call,
          backtrace, byteStack, std::uint32_t(sizeof(void*)), std::uint64_t(::sysconf(_SC_PAGESIZE)),
          std::string(psizam::native_aot_build_identity()), std::string(PSIBASE_NATIVE_AOT_HOST_ID)});
#else
      return {};
#endif
   }

   std::vector<char> NativeVMOptions::load_native_aot(
       const std::array<std::uint8_t, 32>& identity) const
   {
      if (nativeArtifacts)
         if (auto artifact = nativeArtifacts->load(identity)) return std::move(*artifact);
      return {};
   }

   void NativeVMOptions::store_native_aot(const std::array<std::uint8_t, 32>& identity,
                                          std::span<const char> artifact) const noexcept
   {
      if (nativeArtifacts) nativeArtifacts->store(identity, artifact);
   }

   void checkVMOptionCeilings(const VMOptions& options)
   {
      for (const auto& entry : vmOptionCeilings)
         if (options.*entry.member > entry.ceiling)
            throw std::runtime_error("wasm configuration: " + std::string(entry.name) + " is " +
                                     std::to_string(options.*entry.member) +
                                     ", above its ceiling of " + std::to_string(entry.ceiling));
   }

   VMOptions vmOptionsAtCeiling()
   {
      VMOptions result;
      for (const auto& entry : vmOptionCeilings)
         result.*entry.member = entry.ceiling;
      return result;
   }

   namespace
   {
      [[noreturn]] void exceeds(std::string_view member, std::uint64_t actual, std::uint64_t limit)
      {
         throw std::runtime_error("native WASM exceeds " + std::string(member) + ": " +
                                  std::to_string(actual) + " is more than " +
                                  std::to_string(limit));
      }
#define PSIBASE_VM_LIMIT(options, member, actual)                                    \
   do                                                                                \
   {                                                                                 \
      if (const std::uint64_t value = (actual); value > (options).member) \
         exceeds(#member, value, (options).member);                                  \
   } while (false)

      struct Reader
      {
         std::span<const std::uint8_t> bytes;
         std::span<const std::uint8_t> take(std::size_t size)
         {
            if (size > bytes.size())
               throw std::runtime_error("truncated native WASM declaration");
            auto result = bytes.first(size);
            bytes       = bytes.subspan(size);
            return result;
         }
         std::uint8_t  byte() { return take(1)[0]; }
         std::uint32_t u32()
         {
            std::uint32_t value = 0;
            for (unsigned shift = 0; shift < 35; shift += 7)
            {
               auto b = byte();
               if (shift == 28 && (b & 0xf0))
                  throw std::runtime_error("native WASM integer overflow");
               value |= std::uint32_t(b & 0x7f) << shift;
               if (!(b & 0x80))
                  return value;
            }
            throw std::runtime_error("invalid native WASM integer");
         }
         // A LEB128 integer of any width, not interpreted.
         void skipInteger()
         {
            for (unsigned i = 0; i < 10; ++i)
               if (!(byte() & 0x80))
                  return;
            throw std::runtime_error("invalid native WASM integer");
         }
         std::uint32_t name()
         {
            auto size = u32();
            take(size);
            return size;
         }
         // A value type as one byte. The two-byte forms (ref null? heaptype)
         // belong to the typed function references proposal, which is off.
         // psizam's parser refuses them too (enable_typed_references in
         // NativeVMOptions, which is what covers instructions); this pass
         // reads one byte per type, so it has to refuse them where it meets
         // them or it would go on reading out of step, and it names the
         // proposal where the parser would say "invalid local type".
         void valueType()
         {
            auto type = byte();
            if (type == 0x63 || type == 0x64)
               throw std::runtime_error(
                   "native WASM does not support typed function references");
         }
         // A constant expression. This pass only has to get past it: what
         // may stand in one is the parser's to decide. More than one
         // instruction is the extended constant expressions proposal
         // (i32/i64 add, sub, mul over constants and globals), which is off
         // by the parser's switch (enable_extended_const in
         // NativeVMOptions), so the pass reads that form and leaves the
         // refusal, in every place it can occur, to the parser. Anything
         // else it cannot read.
         void constantExpression()
         {
            const auto invalid = []
            { throw std::runtime_error("invalid native WASM constant expression"); };
            switch (byte())
            {
               case 0x41:  // i32.const
               case 0x42:  // i64.const
               case 0x23:  // global.get
               case 0xd2:  // ref.func
                  skipInteger();
                  break;
               case 0x43:  // f32.const
                  take(4);
                  break;
               case 0x44:  // f64.const
                  take(8);
                  break;
               case 0xd0:  // ref.null
                  skipInteger();
                  break;
               case 0xfd:  // v128.const
                  if (u32() != 12)
                     invalid();
                  take(16);
                  break;
               default:
                  invalid();
            }
            for (;;)
               switch (byte())
               {
                  case 0x0b:  // end
                     return;
                  case 0x41:  // i32.const
                  case 0x42:  // i64.const
                  case 0x23:  // global.get
                     skipInteger();
                     break;
                  case 0x6a:  // i32.add, sub, mul
                  case 0x6b:
                  case 0x6c:
                  case 0x7c:  // i64.add, sub, mul
                  case 0x7d:
                  case 0x7e:
                     break;
                  default:
                     invalid();
               }
         }
      };

      struct FunctionType
      {
         std::uint32_t params  = 0;
         std::uint32_t results = 0;
      };
   }  // namespace

   void validateNativeWasm(std::span<const std::uint8_t> code, const NativeVMOptions& options)
   {
      PSIBASE_VM_LIMIT(options, max_module_bytes, code.size());
      Reader                 input{code};
      constexpr std::uint8_t header[] = {0, 'a', 's', 'm', 1, 0, 0, 0};
      auto                   actual   = input.take(sizeof(header));
      if (!std::equal(actual.begin(), actual.end(), std::begin(header)))
         throw std::runtime_error("invalid native WASM header");
      std::vector<FunctionType>  types;
      // The type index of every function, imported ones first.
      std::vector<std::uint32_t> functions;
      std::uint32_t              imported = 0;
      // wasmparser's "effective type size" of the module's imports and
      // exports, which wasmtime refuses at 1,000,000.
      std::uint64_t typeSize = 1;
      auto          function = [&](std::uint32_t index) -> const FunctionType*
      {
         if (index >= functions.size() || functions[index] >= types.size())
            return nullptr;  // The parser refuses the module.
         return &types[functions[index]];
      };
      auto entity = [&](const FunctionType* type)
      {
         typeSize += type ? 2 + std::uint64_t(type->params) + type->results : 1;
         PSIBASE_VM_LIMIT(options, max_type_size, typeSize);
      };
      while (!input.bytes.empty())
      {
         auto   id = input.byte();
         Reader section{input.take(input.u32())};
         if (id == 0)
         {
            PSIBASE_VM_LIMIT(options, max_symbol_bytes, section.name());
         }
         else if (id == 1)
         {
            auto count = section.u32();
            PSIBASE_VM_LIMIT(options, max_type_section_elements, count);
            types.reserve(std::min<std::size_t>(count, section.bytes.size()));
            while (count--)
            {
               if (section.byte() != 0x60)
                  throw std::runtime_error("native WASM types must be function types");
               FunctionType type;
               type.params = section.u32();
               PSIBASE_VM_LIMIT(options, max_function_params, type.params);
               for (auto i = type.params; i--;)
                  section.valueType();
               type.results = section.u32();
               PSIBASE_VM_LIMIT(options, max_function_results, type.results);
               for (auto i = type.results; i--;)
                  section.valueType();
               types.push_back(type);
            }
         }
         else if (id == 2)
         {
            auto count = section.u32();
            PSIBASE_VM_LIMIT(options, max_import_section_elements, count);
            while (count--)
            {
               PSIBASE_VM_LIMIT(options, max_symbol_bytes, section.name());
               PSIBASE_VM_LIMIT(options, max_symbol_bytes, section.name());
               if (section.byte() != 0)
                  throw std::runtime_error("native WASM permits function imports only");
               functions.push_back(section.u32());
               ++imported;
               entity(function(functions.size() - 1));
            }
         }
         else if (id == 3)
         {
            auto count = section.u32();
            PSIBASE_VM_LIMIT(options, max_function_section_elements, count);
            functions.reserve(functions.size() + std::min<std::size_t>(count, section.bytes.size()));
            while (count--)
               functions.push_back(section.u32());
         }
         else if (id == 4 || id == 5)
         {
            auto count = section.u32();
            if (id == 4)
               PSIBASE_VM_LIMIT(options, max_table_section_elements, count);
            else
               PSIBASE_VM_LIMIT(options, max_memory_section_elements, count);
            // The host interface addresses one table and one memory,
            // whatever the configuration says.
            if (count > 1)
               throw std::runtime_error("native WASM permits one table and one memory");
            if (count)
            {
               if (id == 4 && section.byte() != 0x70)
                  throw std::runtime_error("native WASM requires a funcref table");
               auto flags = section.u32();
               if (flags > 1)
                  throw std::runtime_error(
                      "native WASM does not support shared or memory64 resources");
               auto initial = section.u32();
               if (id == 4)
                  PSIBASE_VM_LIMIT(options, max_table_elements, initial);
               else
                  PSIBASE_VM_LIMIT(options, max_pages, initial);
               if (flags)
               {
                  auto maximum = section.u32();
                  if (maximum < initial || (id == 5 && maximum > 65536))
                     throw std::runtime_error("invalid native WASM resource maximum");
               }
            }
         }
         else if (id == 6)
         {
            auto count = section.u32();
            PSIBASE_VM_LIMIT(options, max_global_section_elements, count);
            while (count--)
            {
               section.valueType();
               section.byte();
               section.constantExpression();
            }
         }
         else if (id == 7)
         {
            auto count = section.u32();
            PSIBASE_VM_LIMIT(options, max_export_section_elements, count);
            while (count--)
            {
               PSIBASE_VM_LIMIT(options, max_symbol_bytes, section.name());
               auto kind  = section.byte();
               auto index = section.u32();
               entity(kind == 0 ? function(index) : nullptr);
            }
         }
         else if (id == 9)
         {
            auto count = section.u32();
            PSIBASE_VM_LIMIT(options, max_element_section_elements, count);
            while (count--)
            {
               auto flags = section.u32();
               if (flags > 7)
                  throw std::runtime_error("invalid native WASM element segment");
               const bool active      = !(flags & 1);
               const bool explicitly  = flags & 2;
               const bool expressions = flags & 4;
               if (active)
               {
                  if (explicitly)
                     section.u32();  // table index
                  section.constantExpression();
               }
               if (!active || explicitly)
               {
                  // An element kind (0) or a reference type.
                  if (expressions)
                     section.valueType();
                  else
                     section.byte();
               }
               auto items = section.u32();
               PSIBASE_VM_LIMIT(options, max_element_segment_elements, items);
               while (items--)
                  if (expressions)
                     section.constantExpression();
                  else
                     section.u32();
            }
         }
         else if (id == 10)
         {
            auto count = section.u32();
            for (std::uint32_t i = 0; i < count; ++i)
            {
               auto size = section.u32();
               PSIBASE_VM_LIMIT(options, max_code_bytes, size);
               Reader        body{section.take(size)};
               std::uint64_t locals = 0;
               if (auto type = function(imported + i))
                  locals = type->params;
               for (auto groups = body.u32(); groups--;)
               {
                  locals += body.u32();
                  body.valueType();
                  PSIBASE_VM_LIMIT(options, max_function_locals, locals);
               }
               PSIBASE_VM_LIMIT(options, max_function_locals, locals);
            }
         }
         else if (id == 11)
         {
            auto count = section.u32();
            PSIBASE_VM_LIMIT(options, max_data_section_elements, count);
            while (count--)
            {
               auto flags = section.u32();
               if (flags > 2)
                  throw std::runtime_error("invalid native WASM data segment");
               if (flags == 2)
                  section.u32();  // memory index
               if (flags != 1)
                  section.constantExpression();
               auto size = section.u32();
               PSIBASE_VM_LIMIT(options, max_data_segment_bytes, size);
               section.take(size);
            }
         }
         else if (id == 13)
         {
            throw std::runtime_error("native WASM exception tags are not supported");
         }
      }
   }
   const std::vector<NativeHostFunction>& nativeHostFunctions()
   {
      // psizam derives each wasm signature from the C++ member function, the
      // same way for this table as for the psizam engines' own registration.
      static const std::vector<NativeHostFunction> table = []
      {
         using Derive = psizam::registered_host_functions<NativeFunctions>;
#define PSIBASE_HOST_FUNCTION(name) Derive::add<&NativeFunctions::name>("env", #name);
         PSIBASE_NATIVE_HOST_FUNCTIONS(PSIBASE_HOST_FUNCTION)
#undef PSIBASE_HOST_FUNCTION
         auto&                           derived = Derive::mappings::get();
         std::vector<NativeHostFunction> result;
#define PSIBASE_HOST_FUNCTION(name)                                              \
   {                                                                             \
      const auto& types = derived.host_functions[derived.named_mapping.at({"env", #name})]; \
      result.push_back({"env", #name, types.params, types.ret});                 \
   }
         PSIBASE_NATIVE_HOST_FUNCTIONS(PSIBASE_HOST_FUNCTION)
#undef PSIBASE_HOST_FUNCTION
         return result;
      }();
      return table;
   }

   void checkNativeHostFunction(std::string_view              engine,
                                std::string_view              name,
                                std::span<const std::uint8_t> params,
                                std::span<const std::uint8_t> results)
   {
      for (const auto& function : nativeHostFunctions())
         if (function.name == name)
         {
            if (!std::ranges::equal(function.params, params) ||
                !std::ranges::equal(function.results, results))
               throw std::runtime_error("the " + std::string(engine) +
                                        " engine's signature of host function " +
                                        std::string(name) + " is not the admission table's");
            return;
         }
      throw std::runtime_error("the " + std::string(engine) + " engine registers host function " +
                               std::string(name) + ", which is not in the admission table");
   }

   void checkNativeHostFunctionCount(std::string_view engine, std::size_t registered)
   {
      if (registered != nativeHostFunctions().size())
         throw std::runtime_error("the " + std::string(engine) + " engine registers " +
                                  std::to_string(registered) + " host functions; the admission " +
                                  "table has " + std::to_string(nativeHostFunctions().size()));
   }

   namespace
   {
      // Every import must be a function the node provides, with the node's
      // signature. (validateNativeWasm has already refused imports that are
      // not functions.) Importing a function more than once is allowed.
      void checkImports(const psizam::module& module)
      {
         auto text = [](const std::vector<std::uint8_t>& bytes)
         { return std::string_view(reinterpret_cast<const char*>(bytes.data()), bytes.size()); };
         for (const auto& import : module.imports)
         {
            const auto name = std::string(text(import.module_str)) + "." +
                              std::string(text(import.field_str));
            if (import.kind != psizam::external_kind::Function)
               throw std::runtime_error("native WASM permits function imports only: " + name);
            const NativeHostFunction* found = nullptr;
            for (const auto& function : nativeHostFunctions())
               if (function.module == text(import.module_str) &&
                   function.name == text(import.field_str))
                  found = &function;
            if (!found)
               throw std::runtime_error("native WASM imports " + name +
                                        ", which is not a host function");
            const auto& type = module.types.at(import.type.func_t);
            if (!std::ranges::equal(found->params, type.param_types) ||
                !std::ranges::equal(found->results, type.return_types))
               throw std::runtime_error("native WASM imports " + name +
                                        " with a signature that is not the host function's");
         }
      }
   }  // namespace

   NativeEntryPoints nativeEntryPoints(const psizam::module& module)
   {
      constexpr std::uint8_t i64 = 0x7e;
      struct EntryPoint
      {
         std::string_view                           name;
         std::vector<std::uint8_t>                  params;
         std::optional<std::uint32_t> NativeEntryPoints::* index;
         const char*                                signature;
         // Whether a module without it is refused (gofractally/psibase#2261).
         // Every action goes through start and called, so a service must
         // have both; serve and processTransaction are for the services
         // that are asked for them.
         bool required;
      };
      static const std::vector<EntryPoint> known = {
          {"start", {i64}, &NativeEntryPoints::start, "(i64) -> ()", true},
          {"called", {i64, i64}, &NativeEntryPoints::called, "(i64, i64) -> ()", true},
          {"serve", {}, &NativeEntryPoints::serve, "() -> ()", false},
          {"processTransaction", {}, &NativeEntryPoints::processTransaction, "() -> ()", false},
      };
      NativeEntryPoints result;
      for (const auto& exported : module.exports)
      {
         const std::string_view name(reinterpret_cast<const char*>(exported.field_str.data()),
                                     exported.field_str.size());
         for (const auto& entry : known)
         {
            if (entry.name != name)
               continue;
            const auto refuse = [&]
            {
               throw std::runtime_error("native WASM export " + std::string(name) +
                                        " must be a function " + entry.signature);
            };
            if (exported.kind != psizam::external_kind::Function)
               refuse();
            const auto& type = module.get_function_type(exported.index);
            if (!std::ranges::equal(entry.params, type.param_types) || !type.return_types.empty())
               refuse();
            result.*entry.index = exported.index;
         }
      }
      for (const auto& entry : known)
         if (entry.required && !(result.*entry.index))
            throw std::runtime_error("native WASM must export " + std::string(entry.name) +
                                     ", a function " + entry.signature);
      return result;
   }

   namespace
   {
      // What the admission's code writer enforces and reports (below).
      struct AdmissionLimits
      {
         std::uint32_t maxBlockParams            = 0;
         std::uint64_t maxBranchLocalPairs       = 0;
         std::uint64_t maxModuleBranchLocalPairs = 0;
         // If set, receives the measure of each defined function.
         std::vector<std::uint64_t>* measured = nullptr;
      };
      // psizam's validating parser with a code writer that emits nothing
      // and checks what the parser has no option for: the parameters of a
      // block, loop or if, and the measure that max_branch_local_pairs and
      // max_module_branch_local_pairs limit (defined at vmOptionCeilings in
      // PsizamPolicy.hpp).
      //
      // The parser decodes every instruction to validate it and calls its
      // code writer for each, so the measure needs no second reading of the
      // bodies and no instruction decoder of its own: it is computed from
      // the calls for block, loop, if, end, the branches and the two writes
      // of a local.
      //
      // On the psizam engines these are checked here only, at the write of
      // a code row (admitNativeWasm); the adapter's own parse before it
      // compiles (ExecutionContext.cpp) does not repeat them. That is
      // intended: the adapter's parse is not the admission.
      struct AdmissionWriter : psizam::detail::null_writer
      {
         // The parser constructs its writer, so the limits reach it here.
         static inline thread_local AdmissionLimits limits;

         AdmissionWriter(psizam::growable_allocator& allocator,
                         std::size_t                 sourceBytes,
                         psizam::module&             module,
                         bool                        backtrace         = false,
                         bool                        stackLimitIsBytes = false,
                         std::uint32_t               compileThreads    = 0)
             : null_writer(allocator, sourceBytes, module, backtrace, stackLimitIsBytes,
                           compileThreads),
               imported(module.get_imported_functions_size())
         {
         }

         void emit_prologue(const psizam::func_type&                 type,
                            const std::vector<psizam::local_entry>& declared,
                            std::uint32_t)
         {
            locals = type.param_types.size();
            for (const auto& group : declared)
               locals += group.count;
            if (lastWrite.size() < locals)
               lastWrite.resize(locals, 0);
            // Writes are numbered through the whole module, so that a
            // number left by an earlier function is below `began` and
            // nothing has to be cleared between functions.
            began = writes + 1;
            pairs = 0;
            regions.clear();
            // The function itself: its end is reached by falling into it.
            regions.push_back(
                {.edges = 1, .carried = std::uint32_t(type.return_types.size()), .opened = began});
         }
         void emit_epilogue(const psizam::func_type&,
                            const std::vector<psizam::local_entry>&,
                            std::uint32_t index)
         {
            const auto function = std::to_string(std::uint64_t(imported) + index);
            if (limits.measured)
               limits.measured->push_back(pairs);
            if (pairs > limits.maxBranchLocalPairs)
               throw std::runtime_error(
                   "native WASM exceeds max_branch_local_pairs: " + std::to_string(pairs) +
                   " is more than " + std::to_string(limits.maxBranchLocalPairs) +
                   " in function " + function);
            modulePairs += pairs;
            if (modulePairs > limits.maxModuleBranchLocalPairs)
               throw std::runtime_error(
                   "native WASM exceeds max_module_branch_local_pairs: " +
                   std::to_string(modulePairs) + " is more than " +
                   std::to_string(limits.maxModuleBranchLocalPairs) + " at function " + function);
         }
         void emit_block(std::uint8_t type = 0x40, std::uint32_t results = 0,
                         std::uint32_t params = 0)
         {
            open(params, 1, resultsOf(type, results));
         }
         label_t emit_loop(std::uint8_t = 0x40, std::uint32_t = 0, std::uint32_t params = 0)
         {
            open(params, 1, params);
            return {};
         }
         branch_t emit_if(std::uint8_t type = 0x40, std::uint32_t results = 0,
                          std::uint32_t params = 0)
         {
            open(params, 2, resultsOf(type, results));
            return {};
         }
         label_t emit_end()
         {
            if (regions.empty())
               return {};  // The parser refuses an end that closes nothing.
            auto region = regions.back();
            regions.pop_back();
            if (regions.empty())
               region.written = 0;  // No local is read after the function's end.
            else
               regions.back().written += region.written;
            pairs += region.edges * (region.written + region.carried);
            return {};
         }
         branch_t emit_br(std::uint32_t, std::uint8_t, std::uint32_t label = 0, std::uint32_t = 0)
         {
            branch(label);
            return {};
         }
         branch_t emit_br_if(std::uint32_t, std::uint8_t, std::uint32_t label = 0,
                             std::uint32_t = 0, std::uint32_t = 0)
         {
            branch(label);
            return {};
         }
         struct br_table_parser
         {
            AdmissionWriter* writer;
            branch_t emit_case(std::uint32_t, std::uint8_t, std::uint32_t label = UINT32_MAX,
                               std::uint32_t = 0, std::uint32_t = 0)
            {
               writer->branch(label);
               return {};
            }
            branch_t emit_default(std::uint32_t, std::uint8_t, std::uint32_t label = UINT32_MAX,
                                  std::uint32_t = 0, std::uint32_t = 0)
            {
               writer->branch(label);
               return {};
            }
         };
         br_table_parser emit_br_table(std::uint32_t) { return {this}; }
         void emit_set_local(std::uint32_t local, std::uint8_t) { write(local); }
         void emit_tee_local(std::uint32_t local, std::uint8_t) { write(local); }

        private:
         // A block, loop or if that is open; the first is the function.
         struct Region
         {
            // Into its label: its own, and one for each branch so far.
            std::uint64_t edges = 0;
            // The operands a branch to its label carries.
            std::uint32_t carried = 0;
            // The number of the first write inside it.
            std::uint64_t opened = 0;
            // The locals whose latest write is inside it and before the
            // next open region began. Over a region and the open regions
            // inside it these add up to the distinct locals written in it,
            // which is all a region needs when it closes: it is then the
            // innermost, and it hands its count to the one around it.
            std::uint64_t written = 0;
         };
         // The results of a block type as the parser passes it: a count for
         // a type index, otherwise one value type or none (0x40).
         static std::uint32_t resultsOf(std::uint8_t type, std::uint32_t results)
         {
            return results ? results : type != 0x40;
         }
         void open(std::uint32_t params, std::uint64_t edges, std::uint32_t carried)
         {
            if (params > limits.maxBlockParams)
               exceeds("max_block_params", params, limits.maxBlockParams);
            regions.push_back({.edges = edges, .carried = carried, .opened = writes + 1});
         }
         void branch(std::uint32_t label)
         {
            if (label < regions.size())  // The parser has refused any other.
               ++regions[regions.size() - 1 - label].edges;
         }
         void write(std::uint32_t local)
         {
            if (local >= locals || regions.empty())
               return;  // The parser has refused it.
            auto& last = lastWrite[local];
            if (last >= began)
            {
               // Written before in this function: it is no longer the
               // latest write of the region that one was in, which is the
               // last region opened at or before it.
               auto after = std::upper_bound(
                   regions.begin(), regions.end(), last,
                   [](std::uint64_t write, const Region& region) { return write < region.opened; });
               --std::prev(after)->written;
            }
            last = ++writes;
            ++regions.back().written;
         }

         std::uint32_t imported = 0;
         // The sum over the functions read so far.
         std::uint64_t modulePairs = 0;
         // Writes of a local read so far in the module, and for each local
         // index the number of the latest one.
         std::uint64_t              writes = 0;
         std::vector<std::uint64_t> lastWrite;
         // Of the function being read: parameters plus declared locals, the
         // number of its first write, its measure so far, its open regions.
         std::uint64_t       locals = 0;
         std::uint64_t       began  = 1;
         std::uint64_t       pairs  = 0;
         std::vector<Region> regions;
      };

      // The parser's refusals for the limits validateNativeWasm leaves to
      // it, by the member of VMOptions they enforce.
      std::string limitOf(std::string_view detail)
      {
         static constexpr std::pair<std::string_view, std::string_view> known[] = {
             {"mutable globals exceeded limit", "max_mutable_global_bytes"},
             {"local variable limit exceeded", "max_func_local_bytes"},
             {"nested structures validation failure", "max_nested_structures"},
             {"Too many labels in br_table", "max_br_table_elements"},
         };
         for (const auto& [message, member] : known)
            if (detail == message)
               return "native WASM exceeds " + std::string(member) + ": ";
         return {};
      }

      // Both passes of admission; `use` gets the parsed module. `measured`,
      // if given, gets what max_branch_local_pairs limits for each defined
      // function, and that limit and the module's are then not applied.
      template <typename F>
      void admit(std::span<const std::uint8_t> code,
                 const NativeVMOptions&        policy,
                 F&&                           use,
                 std::vector<std::uint64_t>*   measured = nullptr)
      {
         validateNativeWasm(code, policy);
         try
         {
            // The parser takes the module by mutable reference.
            psizam::wasm_code              bytes(code.begin(), code.end());
            psizam::module                 module;
            psizam::detail::null_debug_info debug;
            module.allocator.use_default_memory();
            constexpr auto unlimited = std::numeric_limits<std::uint64_t>::max();
            AdmissionWriter::limits  = {
                 .maxBlockParams      = policy.max_block_params,
                 .maxBranchLocalPairs = measured ? unlimited : policy.max_branch_local_pairs,
                 .maxModuleBranchLocalPairs =
                    measured ? unlimited : policy.max_module_branch_local_pairs,
                 .measured = measured};
            psizam::detail::binary_parser<AdmissionWriter, NativeVMOptions,
                                          psizam::detail::null_debug_info>{
                module.allocator, policy, false,
                psizam::detail::has_max_stack_bytes<NativeVMOptions>}
                .parse_module(bytes, module, debug);
            use(module);
         }
         catch (const psizam::exception& e)
         {
            // psizam reports the reason separately from the kind of error.
            throw std::runtime_error(limitOf(e.detail()) + std::string(e.what()) + ": " +
                                     e.detail());
         }
      }

      std::vector<std::uint32_t> costsOf(const psizam::module& module)
      {
         std::vector<std::uint32_t> result;
         result.reserve(module.code.size());
         for (const auto& body : module.code)
            result.push_back(body.byte_stack_usage);
         return result;
      }
   }  // namespace

   std::vector<std::uint32_t> admitNativeModule(std::span<const std::uint8_t> code,
                                                const VMOptions&              options,
                                                std::uint8_t                  vmVersion)
   {
      std::vector<std::uint32_t> result;
      admit(code, NativeVMOptions{options, {}, vmVersion},
            [&](const psizam::module& module) { result = costsOf(module); });
      return result;
   }

   BranchLocalPairs nativeBranchLocalPairs(std::span<const std::uint8_t> code,
                                           const VMOptions&              options,
                                           std::uint8_t                  vmVersion)
   {
      BranchLocalPairs result;
      admit(
          code, NativeVMOptions{options, {}, vmVersion},
          [&](const psizam::module& module)
          { result.imported = module.get_imported_functions_size(); },
          &result.functions);
      return result;
   }

   NativeAdmission admitNativeWasm(std::span<const std::uint8_t> code,
                                   const VMOptions&              options,
                                   std::uint8_t                  vmVersion)
   {
      NativeAdmission result;
      admit(code, NativeVMOptions{options, {}, vmVersion},
            [&](const psizam::module& module)
            {
               checkImports(module);
               result.entryPoints = nativeEntryPoints(module);
               result.costs       = costsOf(module);
            });
      return result;
   }

}  // namespace psibase
