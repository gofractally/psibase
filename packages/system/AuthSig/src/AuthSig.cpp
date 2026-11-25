#include <services/system/AuthSig.hpp>

#include <concepts>
#include <psibase/dispatch.hpp>
#include <psibase/verifier.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/Spki.hpp>
#include <services/system/StagedTx.hpp>

using namespace psibase;

namespace SystemService
{
   namespace AuthSig
   {
      template <typename T>
      concept AnyByte =
          std::same_as<T, char> || std::same_as<T, unsigned char> || std::same_as<T, std::byte>;

      template <AnyByte T, AnyByte U>
      bool equalByteVector(const std::vector<T>& lhs, const std::vector<U>& rhs)
      {
         return lhs.size() == rhs.size() && std::memcmp(lhs.data(), rhs.data(), lhs.size()) == 0;
      }

      // A key is stored only if some verifier accepts it; otherwise nothing
      // could ever authorize the account.
      void checkKey(const SubjectPublicKeyInfo& key)
      {
         check(verifierFor(key.data).has_value(), "unsupported public key");
      }

      bool AuthSig::checkAuthSys(uint32_t                    flags,
                                 psibase::AccountNumber      sender,
                                 ServiceMethod               action,
                                 std::vector<psibase::Claim> claims)
      {
         auto row = open<AuthTable>(KvMode::read).getIndex<0>().get(sender);

         check(row.has_value(), "sender does not have a public key");

         // A claim counts only if it names the verifier for the stored key's
         // type: any other service would be checking something else.
         const auto& expected = row->pubkey.data;
         const auto  verifier = verifierFor(expected);
         if (!verifier)
            return false;
         for (auto& claim : claims)
         {
            if (claim.service == *verifier && equalByteVector(claim.rawData, expected))
            {
               return true;
            }
         }
         return false;
      }

      void AuthSig::canAuthUserSys(psibase::AccountNumber user)
      {
         // Anyone with a public key in the AuthTable may use AuthSig
         auto row = open<AuthTable>(KvMode::read).getIndex<0>().get(user);
         check(row.has_value(), "sender does not have a public key");
      }

      void AuthSig::setKey(SubjectPublicKeyInfo key)
      {
         checkKey(key);
         auto authTable = open<AuthTable>(KvMode::readWrite);
         authTable.put(AuthRecord{.account = getSender(), .pubkey = std::move(key)});
      }

      std::vector<psibase::AccountNumber> AuthSig::getDlgsSys(psibase::AccountNumber sender)
      {
         return {};
      }

      bool AuthSig::isAuthSys(psibase::AccountNumber              sender,
                              std::vector<psibase::AccountNumber> authorizers)
      {
         return std::ranges::contains(authorizers, sender);
      }

      bool AuthSig::isRejectSys(psibase::AccountNumber              sender,
                                std::vector<psibase::AccountNumber> rejecters)
      {
         return std::ranges::contains(rejecters, sender);
      }

      void AuthSig::newAccount(psibase::AccountNumber name, SubjectPublicKeyInfo key)
      {
         checkKey(key);
         auto authTable = open<AuthTable>(KvMode::readWrite);
         authTable.put(AuthRecord{.account = name, .pubkey = std::move(key)});

         to<Accounts>().newAccount(name, AuthSig::service, NewAccountMode::requireNew);
      }
   }  // namespace AuthSig
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthSig::AuthSig)
