#include <psibase/dispatch.hpp>
#include <services/system/SetCode.hpp>

using namespace psibase;

namespace SystemService
{

   namespace
   {
      bool incrementRefCount(CodeRefCountTable& refsTable,
                             const Checksum256& codeHash,
                             std::uint8_t       vmType,
                             std::uint8_t       vmVersion)
      {
         auto count = CodeRefCountRow{codeHash, vmType, vmVersion, 0};
         if (auto row = refsTable.get(count.key()))
         {
            count = *row;
         }
         ++count.numRefs;
         check(count.numRefs != 0, "Integer overflow");
         refsTable.put(count);
         return count.numRefs > 1;
      }
   }  // namespace

   void SetCode::init()
   {
      auto refsTable = SetCode::Tables{}.open<CodeRefCountTable>();
      auto codeTable =
          Table<CodeRow, &CodeRow::codeNum>{CodeRow::db, psio::convert_to_key(codePrefix())};
      // clear ref counts table
      for (auto row : refsTable.getIndex<0>())
      {
         refsTable.remove(row);
      }
      // scan code table and increment ref counts
      for (auto row : codeTable.getIndex<0>())
      {
         incrementRefCount(refsTable, row.codeHash, row.vmType, row.vmVersion);
      }
   }

   void SetCode::setCode(AccountNumber     service,
                         uint8_t           vmType,
                         uint8_t           vmVersion,
                         std::vector<char> code)
   {
      auto refsTable = Tables{}.open<CodeRefCountTable>();
      // TODO: validate code here?
      // TODO: special rule for resource charging: pretend CodeByHashRow isn't shared
      // TODO: move numRefs to a different row?
      check(getSender() == service, "sender must match service account");
      check(vmType == 0 && vmVersion == 0, "unsupported type or version");

      auto account = kvGet<CodeRow>(CodeRow::db, codeKey(service));
      if (!account)
      {
         account.emplace();
         account->codeNum = service;
      }

      Checksum256 codeHash = {};
      if (!code.empty())
         codeHash = sha256(code.data(), code.size());
      if (vmType == account->vmType && vmVersion == account->vmVersion &&
          codeHash == account->codeHash)
         return;

      // decrement old reference count
      if (account->codeHash != Checksum256{})
      {
         auto prevCount =
             refsTable.get(std::tuple(account->codeHash, account->vmType, account->vmVersion));
         check(prevCount.has_value(), "Missing reference count");
         if (--prevCount->numRefs)
            refsTable.put(*prevCount);
         else
         {
            refsTable.remove(*prevCount);
            kvRemove(codeByHashKey(account->codeHash, account->vmType, account->vmVersion));
         }
      }

      account->codeHash  = codeHash;
      account->vmType    = vmType;
      account->vmVersion = vmVersion;
      if (account->codeHash != Checksum256{} || account->flags)
         kvPut(account->db, account->key(), *account);
      else
         kvRemove(account->db, account->key());

      if (!code.empty())
      {
         if (incrementRefCount(refsTable, codeHash, vmType, vmVersion))
         {
            CodeByHashRow code_obj{.codeHash  = account->codeHash,
                                   .vmType    = account->vmType,
                                   .vmVersion = account->vmVersion,
                                   .code{code.begin(), code.end()}};
            kvPut(code_obj.db, code_obj.key(), code_obj);
         }
      }
   }  // setCode

   void SetCode::setFlags(psibase::AccountNumber service, uint64_t flags)
   {
      check(getSender() == getReceiver(), "incorrect sender");
      auto account = kvGet<CodeRow>(CodeRow::db, codeKey(service));
      if (!account)
      {
         account.emplace();
         account->codeNum = service;
      }
      account->flags = flags;
      if (account->codeHash != Checksum256{} || account->flags)
         kvPut(account->db, account->key(), *account);
      else
         kvRemove(account->db, account->key());
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::SetCode)
