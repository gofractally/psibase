#pragma once

#include <psibase/tester.hpp>

namespace psibase
{
   /**
    * Manages a chain that uses the default system services.
    */
   class DefaultTestChain : public TestChain
   {
     public:
      DefaultTestChain(
          const std::vector<std::pair<AccountNumber, const char*>>& additionalServices = {},
          uint64_t                                                  hot_bytes          = 1ull << 27,
          uint64_t                                                  warm_bytes         = 1ull << 27,
          uint64_t                                                  cool_bytes         = 1ull << 27,
          uint64_t                                                  cold_bytes = 1ull << 27);

      void deploySystemServices(bool show = false);

      void setBlockProducers(bool show = false);

      void createSysServiceAccounts(bool show = false);

      AccountNumber addService(const char* acc, const char* filename, bool show = false);

      AccountNumber addService(AccountNumber acc, const char* filename, bool show = false);

      // TODO - update to use naming convention
      AccountNumber add_ec_account(const char*      name,
                                   const PublicKey& public_key,
                                   bool             show = false);

      AccountNumber add_ec_account(AccountNumber    name,
                                   const PublicKey& public_key,
                                   bool             show = false);

      void setAuthEc(AccountNumber name, const PublicKey& pubkey, bool show = false);

      AccountNumber add_account(const char*   acc,
                                AccountNumber authService = AccountNumber("auth-any-sys"),
                                bool          show        = false);

      AccountNumber add_account(AccountNumber acc,
                                AccountNumber authService = AccountNumber("auth-any-sys"),
                                bool          show        = false);
      void          registerSysRpc();
   };
}  // namespace psibase
