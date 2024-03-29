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
      // default excludes DocSys and TokenUsers
      DefaultTestChain(const std::vector<std::string>& packageNames =
                           {"AccountSys", "AuthAnySys", "AuthDelegateSys", "AuthSys", "AuthEcSys",
                            "CommonSys", "CpuSys", "ExploreSys", "FractalSys", "InviteSys",
                            "NftSys", "PackageSys", "ProducerSys", "ProxySys", "PsiSpaceSys",
                            "SetCodeSys", "SymbolSys", "TokenSys", "TransactionSys"},
                       bool                  installUI = false,
                       const DatabaseConfig& dbconfig  = {});

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
   };
}  // namespace psibase
