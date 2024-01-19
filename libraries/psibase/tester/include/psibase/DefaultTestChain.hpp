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
      DefaultTestChain(std::span<const std::string> packageNames);
      DefaultTestChain(
          const std::vector<std::pair<AccountNumber, const char*>>& additionalServices = {},
          uint64_t                                                  hot_bytes          = 1ull << 27,
          uint64_t                                                  warm_bytes         = 1ull << 27,
          uint64_t                                                  cool_bytes         = 1ull << 27,
          uint64_t                                                  cold_bytes = 1ull << 27);

      AccountNumber addService(const char* acc, const char* filename, bool show = false);
      AccountNumber addService(AccountNumber acc, const char* filename, bool show = false);
      AccountNumber addService(AccountNumber acc,
                               const char*   filename,
                               std::uint64_t flags,
                               bool          show = false);
      template <typename Service>
      auto addService(const char* filename, bool show = false)
      {
         if constexpr (requires { Service::serviceFlags; })
         {
            return addService(Service::service, filename, Service::serviceFlags, show);
         }
         else
         {
            return addService(Service::service, filename, show);
         }
      }

      AccountNumber addAccount(const char* name, const PublicKey& public_key, bool show = false);
      AccountNumber addAccount(AccountNumber name, const PublicKey& public_key, bool show = false);

      void setAuthEc(AccountNumber name, const PublicKey& pubkey, bool show = false);

      AccountNumber addAccount(const char*   acc,
                               AccountNumber authService = AccountNumber("auth-any-sys"),
                               bool          show        = false);

      AccountNumber addAccount(AccountNumber acc,
                               AccountNumber authService = AccountNumber("auth-any-sys"),
                               bool          show        = false);

     private:
      void registerSysRpc();
      void deploySystemServices(bool show = false);
      void setBlockProducers(bool show = false);
      void createSysServiceAccounts(bool show = false);
   };
}  // namespace psibase
