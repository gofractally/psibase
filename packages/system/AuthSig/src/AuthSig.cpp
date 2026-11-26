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
      // could ever authorize the account. Returns the default verifier.
      AccountNumber defaultVerifier(const SubjectPublicKeyInfo& key)
      {
         auto verifier = verifierFor(key.data);
         check(verifier.has_value(), "unsupported public key");
         return *verifier;
      }

      bool AuthSig::checkAuthSys(uint32_t                    flags,
                                 psibase::AccountNumber      sender,
                                 ServiceMethod               action,
                                 std::vector<psibase::Claim> claims)
      {
         auto row = open<AuthTable>(KvMode::read).getIndex<0>().get(sender);

         check(row.has_value(), "sender does not have a public key");

         // A claim counts only if it names the verifier stored with the key:
         // any other service would be checking something else, and the
         // account chose this one.
         const auto& expected = row->pubkey.data;
         for (auto& claim : claims)
         {
            if (claim.service == row->verifier && equalByteVector(claim.rawData, expected))
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
         auto verifier  = defaultVerifier(key);
         auto authTable = open<AuthTable>(KvMode::readWrite);
         authTable.put(
             AuthRecord{.account = getSender(), .pubkey = std::move(key), .verifier = verifier});
      }

      void AuthSig::setKeyVerifier(psibase::AccountNumber verifier, SubjectPublicKeyInfo key)
      {
         defaultVerifier(key);
         check(isAllowedVerifier(verifier, key.data),
               "verifier is not allowed for this type of key");
         auto authTable = open<AuthTable>(KvMode::readWrite);
         authTable.put(
             AuthRecord{.account = getSender(), .pubkey = std::move(key), .verifier = verifier});
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
         auto verifier  = defaultVerifier(key);
         auto authTable = open<AuthTable>(KvMode::readWrite);
         authTable.put(AuthRecord{.account = name, .pubkey = std::move(key), .verifier = verifier});

         to<Accounts>().newAccount(name, AuthSig::service, NewAccountMode::requireNew);
      }
   }  // namespace AuthSig
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthSig::AuthSig)
