#pragma once

#include <psibase/tester.hpp>

namespace psibase
{
   /**
    * Manages a chain that uses the default system contracts.
    */
   class DefaultTestChain : public test_chain
   {
     public:
      DefaultTestChain(
          const std::vector<std::pair<AccountNumber, const char*>>& additionalContracts = {},
          const char*                                               snapshot            = nullptr,
          uint64_t state_size = 1024 * 1024 * 1024);

      void deploySystemContracts(bool show = false);

      void createSysContractAccounts(bool show = false);

      AccountNumber add_contract(const char* acc, const char* filename, bool show = false);

      AccountNumber add_contract(AccountNumber acc, const char* filename, bool show = false);

      AccountNumber add_ec_account(const char*      name,
                                   const PublicKey& public_key,
                                   bool             show = false);

      AccountNumber add_ec_account(AccountNumber    name,
                                   const PublicKey& public_key,
                                   bool             show = false);

      AccountNumber add_account(const char*   acc,
                                AccountNumber authContract = AccountNumber("auth-fake-sys"),
                                bool          show         = false);

      AccountNumber add_account(AccountNumber acc,
                                AccountNumber authContract = AccountNumber("auth-fake-sys"),
                                bool          show         = false);
      void          registerSysRpc();
   };
}  // namespace psibase