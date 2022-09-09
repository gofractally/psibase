#include <psibase/dispatch.hpp>
#include <services/system/SetCodeSys.hpp>

using namespace psibase;

namespace SystemService
{
   void SetCodeSys::setCode(AccountNumber     contract,
                            uint8_t           vmType,
                            uint8_t           vmVersion,
                            std::vector<char> code)
   {
      // TODO: validate code here?
      // TODO: special rule for resource charging: pretend CodeByHashRow isn't shared
      // TODO: move numRefs to a different row?
      check(getSender() == contract, "sender must match contract account");
      check(vmType == 0 && vmVersion == 0, "unsupported type or version");

      auto account = kvGet<CodeRow>(CodeRow::db, codeKey(contract));
      if (!account)
      {
         account.emplace();
         account->codeNum = contract;
      }

      Checksum256 codeHash;
      if (!code.empty())
         codeHash = sha256(code.data(), code.size());
      if (vmType == account->vmType && vmVersion == account->vmVersion &&
          codeHash == account->codeHash)
         return;

      if (account->codeHash != Checksum256{})
      {
         auto code_obj = kvGet<CodeByHashRow>(
             CodeByHashRow::db,
             codeByHashKey(account->codeHash, account->vmType, account->vmVersion));
         check(code_obj.has_value(), "missing code object");
         if (--code_obj->numRefs)
            kvPut(code_obj->db, code_obj->key(), *code_obj);
         else
            kvRemove(code_obj->db, code_obj->key());
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
         auto code_obj = kvGet<CodeByHashRow>(
             CodeByHashRow::db,
             codeByHashKey(account->codeHash, account->vmType, account->vmVersion));
         if (!code_obj)
         {
            code_obj.emplace(CodeByHashRow{
                .codeHash  = account->codeHash,
                .vmType    = account->vmType,
                .vmVersion = account->vmVersion,
            });
            code_obj->code.assign(code.begin(), code.end());
         }
         ++code_obj->numRefs;
         kvPut(code_obj->db, code_obj->key(), *code_obj);
      }
   }  // setCode

   void SetCodeSys::setFlags(psibase::AccountNumber contract, uint64_t flags)
   {
      check(getSender() == getReceiver(), "incorrect sender");
      auto account = kvGet<CodeRow>(CodeRow::db, codeKey(contract));
      if (!account)
      {
         account.emplace();
         account->codeNum = contract;
      }
      account->flags = flags;
      if (account->codeHash != Checksum256{} || account->flags)
         kvPut(account->db, account->key(), *account);
      else
         kvRemove(account->db, account->key());
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::SetCodeSys)
