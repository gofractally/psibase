// Checks the one property the wasmtime node engine depends on: every module
// the chain policy admits (validateNativeWasm plus psizam's parser under
// NativeVMOptions) also compiles under wasmtime. A module that psizam admits
// and wasmtime refuses would run on one engine and fail on the other.
//
//   VmAdmissionFuzz <file.wasm>...
//
// Exit status is the number of such modules (capped at 255).

#include <psibase/PsizamPolicy.hpp>
#include <psizam/wasmtime_admission.hpp>
#include <psizam/wasmtime_backend.hpp>

#include <fstream>
#include <iostream>
#include <iterator>
#include <map>

namespace wt = psizam::wasmtime;

int main(int argc, char** argv)
{
   struct none
   {
   };
   wt::engine_options options;
   // The node engine's proposal set (ExecutionContextWasmtime.cpp).
   options.features = wt::feature::simd | wt::feature::relaxed_simd | wt::feature::bulk_memory |
                      wt::feature::sign_extension | wt::feature::saturating_float_to_int |
                      wt::feature::reference_types | wt::feature::multi_value |
                      wt::feature::threads;
   wt::runtime<none> rt(options);

   std::size_t                        admitted = 0, refused = 0, split = 0;
   std::map<std::string, std::size_t> refusals;
   for (int i = 1; i < argc; ++i)
   {
      std::ifstream             in(argv[i], std::ios::binary);
      std::vector<std::uint8_t> code((std::istreambuf_iterator<char>(in)), {});
      std::vector<std::uint32_t> costs;
      try
      {
         // The chain's admission under its default limits, without the
         // rules for a service (imports, entry points).
         costs = psibase::admitNativeModule(code, psibase::VMOptions{});
      }
      catch (const psizam::exception& e)
      {
         ++refused;
         ++refusals[e.detail()];
         continue;
      }
      catch (const std::exception& e)
      {
         ++refused;
         ++refusals[e.what()];
         continue;
      }
      ++admitted;
      try
      {
         rt.compile_metered(code, costs);
      }
      catch (const std::exception& e)
      {
         ++split;
         std::cout << "SPLIT " << argv[i] << ": " << e.what() << "\n";
      }
   }
   std::cout << "modules " << (argc - 1) << ", admitted by the chain policy " << admitted
             << ", refused " << refused << ", admitted but refused by wasmtime " << split << "\n";
   for (const auto& [reason, count] : refusals)
      std::cout << "  refused x" << count << ": " << reason << "\n";
   return split > 255 ? 255 : int(split);
}
