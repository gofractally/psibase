#include <contracts/system/SetCodeSys.hpp>
#include <psibase/dispatch.hpp>

using namespace psibase;

namespace system_contract
{
   uint8_t SetCodeSys::setCode(AccountNumber     contract,
                               uint8_t           vmType,
                               uint8_t           vmVersion,
                               std::vector<char> code)
   {
      // TODO: validate code
      check(getSender() == contract, "sender must match contract account");
      auto account = kvGet<AccountRow>(AccountRow::db, accountKey(contract));
      check(account.has_value(), "can not set code on a missing account");
      auto codeHash = sha256(code.data(), code.size());
      if (vmType == account->vmType && vmVersion == account->vmVersion &&
          codeHash == account->codeHash)
         return 0;
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
      kvPut(account->db, account->key(), *account);

      auto code_obj = kvGet<CodeByHashRow>(
          CodeByHashRow::db, codeByHashKey(account->codeHash, account->vmType, account->vmVersion));
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

      return 0;
   }  // setCode

}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::SetCodeSys)
