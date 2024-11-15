#pragma once

#include <psibase/tester.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthSig.hpp>

namespace psibase
{
   /**
    * Manages a chain that uses the default system services.
    */
   class DefaultTestChain : public TestChain
   {
     public:
      // default excludes Docs and TokenUsers
      static std::vector<std::string> defaultPackages();
      DefaultTestChain();
      DefaultTestChain(const std::vector<std::string>& packageNames,
                       bool                            installUI = false,
                       const DatabaseConfig&           dbconfig  = {},
                       bool                            pub       = true);

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

      template <typename AuthService>
      void setAuth(AccountNumber name, const auto& pubkey)
      {
         auto n  = name.str();
         auto t1 = this->from(name).to<AuthService>().setKey(pubkey);
         check(psibase::show(false, t1.trace()) == "", "Failed to setkey for " + n);
         auto t2 = this->from(name).to<SystemService::Accounts>().setAuthServ(AuthService::service);
         check(psibase::show(false, t2.trace()) == "", "Failed to setAuthServ for " + n);
      }

      AccountNumber addAccount(const char*                                         name,
                               const SystemService::AuthSig::SubjectPublicKeyInfo& public_key,
                               bool                                                show = false);
      AccountNumber addAccount(AccountNumber                                       name,
                               const SystemService::AuthSig::SubjectPublicKeyInfo& public_key,
                               bool                                                show = false);

      AccountNumber addAccount(const char*   acc,
                               AccountNumber authService = AccountNumber("auth-any"),
                               bool          show        = false);

      AccountNumber addAccount(AccountNumber acc,
                               AccountNumber authService = AccountNumber("auth-any"),
                               bool          show        = false);
   };
}  // namespace psibase
