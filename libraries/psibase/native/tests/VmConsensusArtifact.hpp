#pragma once

// Verification only. Persist trusted locally compiled code, then construct a
// backend that can only reload that file. No compiler/JIT fallback is possible.
#include <psibase/PsizamPolicy.hpp>
#include <psibase/crypto.hpp>
#include <psizam/aot.hpp>

#include <unistd.h>
#include <cerrno>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <stdexcept>
#include <system_error>
#include <tuple>

namespace vm_consensus
{
   inline psibase::Checksum256 artifactIdentity(std::span<const uint8_t> wasm,
                                                 const psibase::NativeVMOptions& options)
   {
      return psibase::sha256(std::tuple{
          std::string("psibase-consensus-fixture-v1"),
          std::vector<uint8_t>(wasm.begin(), wasm.end()),
          static_cast<const psibase::VMOptions&>(options), uint8_t(options.fp),
          uint8_t(options.memory_mode), uint8_t(options.checked_kind),
          options.gas_metering, options.limit_table_growth, options.defer_start,
          options.enable_exception_handling, options.enable_atomics,
          options.enable_relaxed_simd, options.enable_tail_calls,
          options.max_memory_section_elements, options.max_func_local_bytes,
          uint8_t(options.max_func_local_bytes_flags), options.stack_usage_for_call,
          options.enable_simd, options.enable_bulk_memory, std::string("LLVM-O2-byte-stack-profile"),
          uint32_t(sizeof(void*))});
   }

   class ArtifactFile
   {
      std::filesystem::path directory;
      bool preserve = false;

     public:
      std::filesystem::path path;
      std::vector<char>     bytes;
      psibase::Checksum256  identity{};

      // Only used by the isolated child. Its path comes from this test's
      // parent; it never compiles or removes the parent's trusted artifact.
      explicit ArtifactFile(const std::filesystem::path& existing) : path(existing)
      {
         std::ifstream input(path, std::ios::binary);
         if (!input)
            throw std::runtime_error("cannot read parent consensus artifact");
         bytes.assign(std::istreambuf_iterator<char>(input), {});
      }

      ArtifactFile(psizam::wasm_code code, const psibase::NativeVMOptions& options)
      {
         psibase::validateNativeWasm(code, options);
         identity = artifactIdentity(code, options);
         psizam::module parsed;
         parsed.allocator.use_default_memory();
         psizam::detail::pzam_compile_result result;
#if defined(__x86_64__)
         result.target_triple = "x86_64-unknown-linux-gnu";
#elif defined(__aarch64__)
         result.target_triple = "aarch64-unknown-linux-gnu";
#endif
         result.softfloat = options.fp == psizam::fp_mode::softfloat;
         result.backtrace = true;
         result.opt_level = 2;
         psizam::detail::null_debug_info debug;
         {
            psizam::detail::binary_parser<psizam::detail::ir_writer_llvm_aot,
                                         psibase::NativeVMOptions,
                                         psizam::detail::null_debug_info>
                parser(parsed.allocator, options, true,
                       psizam::detail::has_max_stack_bytes<psibase::NativeVMOptions>);
            parser.set_compile_result(&result);
            parser.parse_module(code, parsed, debug);
         }
         if (!result.error.empty())
            throw std::runtime_error("consensus fixture AOT compile failed: " + result.error);
         parsed.finalize();
         bytes = psizam::save_native_aot(code, parsed, result, identity);
         auto base = std::filesystem::temp_directory_path();
         if (const char* evidence = std::getenv("PSIBASE_VM_CONSENSUS_EVIDENCE"))
         {
            base = std::filesystem::absolute(evidence);
            std::filesystem::create_directories(base);
            preserve = true;
         }
         auto pattern = (base / "psibase-consensus-aot-XXXXXX").string();
         if (!::mkdtemp(pattern.data()))
            throw std::system_error(errno, std::generic_category(), "consensus artifact directory");
         directory = pattern;
         path      = directory / "module.pzam";
         try
         {
            std::ofstream output(path, std::ios::binary | std::ios::trunc);
            output.exceptions(std::ios::badbit | std::ios::failbit);
            output.write(bytes.data(), bytes.size());
            output.close();
         }
         catch (...)
         {
            std::filesystem::remove_all(directory);
            throw;
         }
      }
      ~ArtifactFile()
      {
         std::error_code ignored;
         if (!directory.empty() && !preserve)
            std::filesystem::remove_all(directory, ignored);
      }
      ArtifactFile(const ArtifactFile&)            = delete;
      ArtifactFile& operator=(const ArtifactFile&) = delete;
   };

   inline thread_local const ArtifactFile* savedArtifact = nullptr;
   struct SavedArtifactScope
   {
      const ArtifactFile* previous = savedArtifact;
      explicit SavedArtifactScope(const ArtifactFile& artifact) { savedArtifact = &artifact; }
      ~SavedArtifactScope() { savedArtifact = previous; }
   };

   template <class Options, class DebugInfo>
   struct SavedFileParser
   {
      const Options& options;
      SavedFileParser(psizam::growable_allocator&, const Options& options, bool, bool)
          : options(options) {}
      psizam::module& parse_module(psizam::wasm_code& wasm, psizam::module& module, DebugInfo&)
      {
         if (!savedArtifact)
            throw std::logic_error("consensus saved-artifact scope is missing");
         std::ifstream input(savedArtifact->path, std::ios::binary);
         if (!input)
            throw std::runtime_error("cannot reopen consensus artifact");
         std::vector<char> bytes{std::istreambuf_iterator<char>(input), {}};
         if (bytes != savedArtifact->bytes)
            throw std::runtime_error("persisted consensus artifact bytes changed");
         const auto identity = artifactIdentity(wasm, options);
         psizam::native_aot_metadata metadata;
         auto loaded = psizam::load_native_aot(bytes, &metadata, identity, wasm);
         if (metadata.identity != identity || metadata.sources.empty())
            throw std::runtime_error("saved consensus identity/debug metadata is missing");
         module.allocator.release_base_memory();
         module           = std::move(loaded);
         loaded.allocator = psizam::growable_allocator{};
         return module;
      }
   };

   struct SavedFileProfile : psizam::aot_profile
   {
      template <class Options, class DebugInfo>
      using parser = SavedFileParser<Options, DebugInfo>;
   };
}  // namespace vm_consensus
