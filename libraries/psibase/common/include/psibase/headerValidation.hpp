#pragma once

#include <algorithm>
#include <boost/container/flat_map.hpp>
#include <psibase/block.hpp>
#include <psibase/nativeTables.hpp>
#include <ranges>
#include <vector>

namespace psibase
{
   template <typename Database>
   void writeCode(Database& db, const std::vector<BlockHeaderAuthAccount>& accounts)
   {
      for (const auto& account : accounts)
      {
         CodeRow row{.codeNum   = account.codeNum,
                     .flags     = CodeRow::isAuthService,
                     .codeHash  = account.codeHash,
                     .vmType    = account.vmType,
                     .vmVersion = account.vmVersion};
         db.kvPut(CodeRow::db, row.key(), row);
      }
   }

   template <typename Database>
   void updateCode(Database&                                  db,
                   const std::vector<BlockHeaderAuthAccount>& oldServices,
                   const std::vector<BlockHeaderAuthAccount>& services)
   {
      std::vector<AccountNumber> removedAccounts;
      auto codeNumView = std::views::transform([](auto& p) { return p.codeNum; });
      std::ranges::set_difference(oldServices | codeNumView, services | codeNumView,
                                  std::back_inserter(removedAccounts));
      for (AccountNumber account : removedAccounts)
      {
         db.kvRemove(CodeRow::db, codeKey(account));
      }
      writeCode(db, services);
   }

   inline auto makeCodeIndex(const std::vector<BlockHeaderCode>& authCode)
   {
      using K = decltype(codeByHashKey(Checksum256(), 0, 0));
      using R = boost::container::flat_map<K, const BlockHeaderCode*>;
      R::sequence_type seq;
      for (const auto& code : authCode)
      {
         auto codeHash = sha256(code.code.data(), code.code.size());
         auto key      = codeByHashKey(codeHash, code.vmType, code.vmVersion);
         seq.push_back({key, &code});
      }
      R result;
      result.adopt_sequence(std::move(seq));
      return result;
   }

   template <typename Database>
   void copyCodeByHash(Database&                                  dest,
                       Database&                                  src,
                       const std::vector<BlockHeaderAuthAccount>& services)
   {
      auto keys = getCodeKeys(services);
      for (const auto& key : keys)
      {
         if (auto row = src.template kvGet<CodeByHashRow>(CodeByHashRow::db, key))
         {
            dest.kvPut(CodeByHashRow::db, key, *row);
         }
         else
         {
            abortMessage("Missing code for auth service");
         }
      }
   }

   template <typename Database>
   void updateCodeByHash(Database&                                  db,
                         const std::vector<BlockHeaderAuthAccount>& oldServices,
                         const std::vector<BlockHeaderAuthAccount>& newServices,
                         const std::vector<BlockHeaderCode>&        authCode)
   {
      auto               prevKeys = getCodeKeys(oldServices);
      auto               nextKeys = getCodeKeys(newServices);
      decltype(prevKeys) removed, added;
      std::ranges::set_difference(prevKeys, nextKeys, std::back_inserter(removed));
      std::ranges::set_difference(nextKeys, prevKeys, std::back_inserter(added));
      auto code = makeCodeIndex(authCode);
      check(std::ranges::includes(nextKeys, code | std::views::transform([](auto& arg) -> auto&
                                                                         { return arg.first; })),
            "Wrong code");
      for (const auto& r : removed)
      {
         db.kvRemove(CodeByHashRow::db, r);
      }
      for (const auto& a : added)
      {
         const auto& [prefix, index, codeHash, vmType, vmVersion] = a;
         auto iter                                                = code.find(a);
         check(iter != code.end(), "Missing required code");
         CodeByHashRow code{.codeHash  = codeHash,
                            .vmType    = vmType,
                            .vmVersion = vmVersion,
                            .numRefs   = 0,
                            .code      = iter->second->code};
         db.kvPut(CodeByHashRow::db, a, code);
      }
   }

   template <typename Database>
   void copyServices(Database&                                  dest,
                     Database&                                  src,
                     const std::vector<BlockHeaderAuthAccount>& services)
   {
      copyCodeByHash(dest, src, services);
      writeCode(dest, services);
   }

   template <typename Database>
   void updateServices(Database&                                  db,
                       const std::vector<BlockHeaderAuthAccount>& oldServices,
                       const std::vector<BlockHeaderAuthAccount>& newServices,
                       const std::vector<BlockHeaderCode>&        authCode)
   {
      updateCodeByHash(db, oldServices, newServices, authCode);
      updateCode(db, oldServices, newServices);
   }
}  // namespace psibase
