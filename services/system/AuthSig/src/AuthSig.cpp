#include <services/system/AuthSig.hpp>

#include <concepts>
#include <psibase/dispatch.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/Spki.hpp>
#include <services/system/StagedTx.hpp>
#include <services/system/VerifySig.hpp>

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

      void AuthSig::checkAuthSys(uint32_t                    flags,
                                 psibase::AccountNumber      requester,
                                 psibase::AccountNumber      sender,
                                 ServiceMethod               action,
                                 std::vector<ServiceMethod>  allowedActions,
                                 std::vector<psibase::Claim> claims)
      {
         auto type = flags & AuthInterface::requestMask;
         if (type == AuthInterface::runAsRequesterReq)
            return;  // Request is valid
         else if (type == AuthInterface::runAsMatchedReq)
            return;  // Request is valid
         else if (type == AuthInterface::runAsMatchedExpandedReq)
            abortMessage("runAs: caller attempted to expand powers");
         else if (type == AuthInterface::runAsOtherReq)
            abortMessage("runAs: caller is not authorized");
         else if (type != AuthInterface::topActionReq)
            abortMessage("unsupported auth type");

         auto row = db.open<AuthTable>().getIndex<0>().get(sender);

         check(row.has_value(), "sender does not have a public key");

         const auto& expected = row->pubkey.data;
         for (auto& claim : claims)
         {
            if (claim.service == VerifySig::service && equalByteVector(claim.rawData, expected))
            {
               // Billing rule: if first proof passes, and auth for first sender passes,
               // then then first sender will be charged even if the transaction fails,
               // including time for executing failed proofs and auths. We require the
               // first auth to be verified by the first signature here to prevent a
               // resource-billing attack against innocent accounts.
               //
               // We do this check after passing the other checks so we can produce the
               // other errors when appropriate.
               if ((flags & AuthInterface::firstAuthFlag) && &claim != &claims[0])
                  abortMessage("first sender is not verified by first signature");
               return;
            }
         }
         auto fingerprint = keyFingerprint(row->pubkey);
         auto hex         = psio::hex(fingerprint.data(), fingerprint.data() + 32);
         abortMessage("transaction does not include a claim for the key " + hex +
                      " needed to authenticate sender " + sender.str() + " for action " +
                      action.service.str() + "::" + action.method.str());
      }

      void AuthSig::canAuthUserSys(psibase::AccountNumber user)
      {
         // Anyone with a public key in the AuthTable may use AuthSig
         auto row = db.open<AuthTable>().getIndex<0>().get(user);
         check(row.has_value(), "sender does not have a public key");
      }

      void AuthSig::setKey(SubjectPublicKeyInfo key)
      {
         auto authTable = db.open<AuthTable>();
         authTable.put(AuthRecord{.account = getSender(), .pubkey = std::move(key)});
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
         to<Accounts>().newAccount(name, AuthAny::service, true);

         Action setKey{
             .sender  = name,
             .service = AuthSig::AuthSig::service,
             .method  = "setKey"_m,
             .rawData = psio::convert_to_frac(std::make_tuple(key))  //
         };

         Action setAuth{
             .sender  = name,
             .service = Accounts::service,
             .method  = "setAuthServ"_m,
             .rawData = psio::convert_to_frac(std::make_tuple(AuthSig::AuthSig::service))  //
         };

         auto _ = recurse();
         to<Transact>().runAs(std::move(setKey), std::vector<ServiceMethod>{});
         to<Transact>().runAs(std::move(setAuth), std::vector<ServiceMethod>{});
      }
   }  // namespace AuthSig
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthSig::AuthSig)