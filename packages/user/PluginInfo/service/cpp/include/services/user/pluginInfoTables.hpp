// C++ table/view types corresponding to PluginInfo service tables.

#pragma once

#include <psibase/AccountNumber.hpp>
#include <psibase/crypto.hpp>
#include <psibase/Table.hpp>

#include <string>
#include <vector>

namespace UserService
{
   struct ParsedFunction
   {
      std::string name;
      bool        dynamicLink;
   };
   PSIO_REFLECT(ParsedFunction, name, dynamicLink)

   struct ParsedInterface
   {
      std::string             namespace_;
      std::string             package;
      std::string             name;
      std::vector<ParsedFunction> funcs;
   };
   PSIO_REFLECT(ParsedInterface, namespace_, package, name, funcs)

   struct ParsedFunctions
   {
      std::string                  namespace_;
      std::string                  package;
      std::vector<ParsedInterface> interfaces;
      std::vector<ParsedFunction>  funcs;
   };
   PSIO_REFLECT(ParsedFunctions, namespace_, package, interfaces, funcs)

   struct PluginCacheRow
   {
      psibase::Checksum256 content_hash;
      ParsedFunctions      imported_funcs;
      ParsedFunctions      exported_funcs;
   };
   PSIO_REFLECT(PluginCacheRow, content_hash, imported_funcs, exported_funcs)
   using PluginCacheTable = psibase::Table<PluginCacheRow, &PluginCacheRow::content_hash>;
   PSIO_REFLECT_TYPENAME(PluginCacheTable)

   struct PluginMappingRow
   {
      psibase::AccountNumber account;
      std::string            path;
      psibase::Checksum256   content_hash;
   };
   PSIO_REFLECT(PluginMappingRow, account, path, content_hash)
   using PluginMappingTable = psibase::Table<PluginMappingRow, &PluginMappingRow::account>;
   PSIO_REFLECT_TYPENAME(PluginMappingTable)

}  // namespace UserService

