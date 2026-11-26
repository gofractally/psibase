// Checks the one property the wasmtime node engine depends on: every module
// the chain policy admits (validateNativeWasm plus psizam's parser under
// NativeVMOptions) also compiles under wasmtime. A module that psizam admits
// and wasmtime refuses would run on one engine and fail on the other.
//
//   VmAdmissionFuzz [--verbose] [--set <member>=<value>]... <file.wasm>...
//   VmAdmissionFuzz --pairs [--functions] [--set <member>=<value>]... <file.wasm>...
//
// Prints one line for each module that is admitted and refused by wasmtime,
//   SPLIT <file>: <wasmtime's message>
// and with --verbose one for every other module as well,
//   ADMIT <file>
//   REFUSE <file>: <admission's message>
// then a line of totals. Exit status is the number of splits (capped at
// 255). The lines and the options are those of psizam's
// psizam_wasmtime_differential_fuzz --admission-only, so psizam's
// run_admission_corpus.py drives either; --admission-only is accepted and
// changes nothing. Registered as the test VmAdmissionCorpus
// (run_vm_admission_corpus.py).
//
// --set gives a member of the wasm configuration (VMOptions) a value other
// than its default, for measuring what a module above a limit costs the
// compiler (gen_compile_cost_modules.py).
//
// --pairs compiles nothing. It prints what max_branch_local_pairs and
// max_module_branch_local_pairs limit, without applying those two:
//   PAIRS <file>: functions N, largest M (function I), sum S
//   REFUSE <file>: <admission's message>
// and with --functions, for each defined function,
//   FUNCTION <file> <function index> <pairs>
// The lines are those of branch_local_pairs.py, which computes the same
// from the bytes alone; the test VmBranchLocalPairs compares the two.

#include <psibase/PsizamPolicy.hpp>
#include <psizam/wasmtime_admission.hpp>
#include <psizam/wasmtime_backend.hpp>

#include <fstream>
#include <iostream>
#include <iterator>
#include <map>
#include <string>
#include <string_view>
#include <vector>

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

   const auto oneLine = [](std::string text)
   {
      for (auto& c : text)
         if (c == '\n' || c == '\r')
            c = ' ';
      return text;
   };
   bool                               verbose = false, pairs = false, functions = false;
   psibase::VMOptions                 limits;
   std::size_t                        modules = 0, admitted = 0, refused = 0, split = 0;
   std::map<std::string, std::size_t> refusals;
   for (int i = 1; i < argc; ++i)
   {
      const std::string_view arg = argv[i];
      if (arg == "--verbose")
      {
         verbose = true;
         continue;
      }
      if (arg == "--admission-only")
         continue;
      if (arg == "--pairs")
      {
         pairs = true;
         continue;
      }
      if (arg == "--functions")
      {
         functions = true;
         continue;
      }
      if (arg == "--set" && i + 1 < argc)
      {
         const std::string_view setting = argv[++i];
         const auto             equals  = setting.find('=');
         bool                   found   = false;
         for (const auto& entry : psibase::vmOptionCeilings)
            if (equals != setting.npos && entry.name == setting.substr(0, equals))
            {
               limits.*entry.member = std::stoul(std::string(setting.substr(equals + 1)));
               found                = true;
            }
         if (!found)
         {
            std::cerr << "--set " << setting << ": not <member of VMOptions>=<value>\n";
            return 255;
         }
         continue;
      }
      ++modules;
      std::ifstream              in(argv[i], std::ios::binary);
      std::vector<std::uint8_t>  code((std::istreambuf_iterator<char>(in)), {});
      std::vector<std::uint32_t> costs;
      std::vector<std::uint64_t> measure;
      std::uint32_t              imports = 0;
      std::string                why;
      try
      {
         // The chain's admission under its default limits, without the
         // rules for a service (imports, entry points).
         if (pairs)
         {
            auto measured = psibase::nativeBranchLocalPairs(code, limits);
            measure       = std::move(measured.functions);
            imports       = measured.imported;
         }
         else
            costs = psibase::admitNativeModule(code, limits);
      }
      catch (const psizam::exception& e)
      {
         why = std::string(e.what()) + ": " + e.detail();
      }
      catch (const std::exception& e)
      {
         why = e.what();
      }
      if (!why.empty())
      {
         ++refused;
         ++refusals[why];
         if (verbose || pairs)
            std::cout << "REFUSE " << argv[i] << ": " << oneLine(why) << "\n";
         continue;
      }
      ++admitted;
      if (pairs)
      {
         std::uint64_t largest = 0, sum = 0;
         std::size_t   at      = 0;
         for (std::size_t f = 0; f < measure.size(); ++f)
         {
            sum += measure[f];
            if (measure[f] > largest)
            {
               largest = measure[f];
               at      = f;
            }
         }
         // Indexes are those of the function index space.
         const std::size_t first = imports;
         if (functions)
            for (std::size_t f = 0; f < measure.size(); ++f)
               std::cout << "FUNCTION " << argv[i] << " " << first + f << " " << measure[f] << "\n";
         std::cout << "PAIRS " << argv[i] << ": functions " << measure.size() << ", largest "
                   << largest << " (function " << (measure.empty() ? 0 : first + at) << "), sum "
                   << sum << "\n";
         continue;
      }
      try
      {
         rt.compile_metered(code, costs);
         if (verbose)
            std::cout << "ADMIT " << argv[i] << "\n";
      }
      catch (const std::exception& e)
      {
         ++split;
         std::cout << "SPLIT " << argv[i] << ": " << oneLine(e.what()) << "\n";
      }
      std::cout.flush();
   }
   std::cout << "modules " << modules << ", admitted by the chain policy " << admitted
             << ", refused " << refused << ", admitted but refused by wasmtime " << split << "\n";
   if (!verbose)
      for (const auto& [reason, count] : refusals)
         std::cout << "  refused x" << count << ": " << reason << "\n";
   return split > 255 ? 255 : int(split);
}
