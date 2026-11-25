// Compiles the services in package files into the native artifact cache.
//
// A node compiles a service the first time its code is stored, and whatever
// executes it first waits. With LLVM that is seconds per service, tens for
// the largest. Run over the packages a build produces, this moves that cost
// to the build: nodes started afterwards, and every test, load the artifacts.
//
//    psibase-precompile DIRECTORY-OR-PACKAGE...
//
// The cache is PSIBASE_NATIVE_AOT_CACHE or the user's, as for a node that
// configures none. A package that cannot be read is reported and skipped;
// a service that does not compile is left for the node to report.
#include <psibase/ExecutionContext.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/package.hpp>

#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <set>
#include <vector>

int main(int argc, char** argv)
{
   std::vector<std::filesystem::path> files;
   for (int i = 1; i < argc; ++i)
   {
      std::filesystem::path argument = argv[i];
      std::error_code       ignored;
      if (std::filesystem::is_directory(argument, ignored))
      {
         for (const auto& entry : std::filesystem::directory_iterator(argument, ignored))
            if (entry.path().extension() == ".psi")
               files.push_back(entry.path());
      }
      else
         files.push_back(argument);
   }
   if (files.empty())
   {
      std::cerr << "usage: psibase-precompile DIRECTORY-OR-PACKAGE...\n";
      return 2;
   }

   // The limits a chain starts with; a chain that changes them compiles again.
   const psibase::WasmConfigRow configuration;
   psibase::WasmCache           cache{1};
   std::set<psibase::Checksum256> seen;
   std::size_t                    unreadable = 0;
   for (const auto& file : files)
   {
      try
      {
         std::ifstream     in(file, std::ios::binary);
         std::vector<char> bytes{std::istreambuf_iterator<char>(in), {}};
         if (!in && !in.eof())
            throw std::runtime_error("cannot read file");
         psibase::PackagedService package{std::move(bytes)};
         for (const auto& [account, header, info] : package.services)
         {
            auto code = package.archive.getEntry(header).read();
            auto hash = psibase::sha256(code.data(), code.size());
            if (seen.insert(hash).second)
               {
               // A chain deploys under its default version; a node loads its
               // own local services under version 0. Either may run this code.
               cache.compileAhead(hash, code, configuration.vmOptions, 0);
               cache.compileAhead(hash, code, configuration.vmOptions, psibase::defaultVmVersion);
            }
         }
      }
      catch (const std::exception& e)
      {
         ++unreadable;
         std::cerr << "psibase-precompile: " << file.string() << ": " << e.what() << "\n";
      }
   }
   cache.finishCompiles();
   std::cout << "psibase-precompile: " << seen.size() << " service(s) from " << files.size()
             << " package(s)\n";
   return unreadable ? 1 : 0;
}
