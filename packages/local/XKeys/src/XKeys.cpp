#include <services/local/XKeys.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/trace.hpp>
#include <services/local/XHttp.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/Spki.hpp>
#include <services/system/Transact.hpp>
#include <services/system/VerifySig.hpp>

using namespace psibase;
using namespace LocalService;
using namespace SystemService;
using namespace SystemService::AuthSig;

namespace
{
   bool isLocal(AccountNumber sender)
   {
      PSIBASE_SUBJECTIVE_TX
      {
         return Native::subjective(KvMode::read).open<CodeTable>().get(sender).has_value();
      }
      __builtin_unreachable();
   }

   using KeyList = std::vector<std::pair<Claim, PrivateKeyInfo>>;
   std::vector<Claim> getClaims(const KeyList& keyList, auto... skip)
   {
      std::vector<Claim> result;
      result.reserve(keyList.size() - sizeof...(skip));
      for (auto iter = keyList.begin(), end = keyList.end(); iter != end; ++iter)
      {
         if (((iter != skip) && ...))
         {
            result.push_back(iter->first);
         }
      }
      return result;
   }

   struct AuthItem
   {
      psibase::AccountNumber sender;
      psibase::ServiceMethod action;
      psibase::AccountNumber authService;
   };

   struct AuthChecker
   {
      AuthChecker(const std::vector<Action>& actions)
      {
         items.reserve(actions.size());
         for (const auto& action : actions)
         {
            items.push_back({action.sender,
                             {action.service, action.method},
                             to<Accounts>().getAuthOf(action.sender)});
         }
         // TODO: unique
      }
      bool checkAuth(const std::vector<Claim>& claims)
      {
         return std::ranges::all_of(items,
                                    [&](const auto& item)
                                    {
                                       return to<AuthInterface>(item.authService)
                                           .checkAuthSys(AuthInterface::readOnlyFlag, item.sender,
                                                         item.action, claims);
                                    });
      }
      std::vector<AuthItem> items;
   };
}  // namespace

SubjectPublicKeyInfo XKeys::newKey()
{
   auto sender = getSender();
   check(isLocal(sender), "service may not create keys");
   auto priv  = PrivateKeyInfo::create();
   auto pub   = getSubjectPublicKeyInfo(priv);
   auto table = open<KeyTable>();
   auto row   = KeyRow{
       .id = sha256(pub.data.data(), pub.data.size()), .owner = sender, .key = std::move(priv)};
   PSIBASE_SUBJECTIVE_TX
   {
      table.put(row);
   }
   return pub;
}

void XKeys::deleteKey(SubjectPublicKeyInfo key)
{
   auto id    = psibase::sha256(key.data.data(), key.data.size());
   auto table = open<KeyTable>();
   PSIBASE_SUBJECTIVE_TX
   {
      auto row = table.get({getSender(), id});
      check(row && row->owner == getSender(), "Key not found");
      table.remove(*row);
   }
}

SignedTransaction XKeys::signTx(std::vector<psibase::Action> actions)
{
   auto sender = getSender();

   // Get available keys
   std::vector<std::pair<Claim, PrivateKeyInfo>> keys;
   PSIBASE_SUBJECTIVE_TX
   {
      keys.clear();
      for (auto row : open<KeyTable>().getIndex<0>().subindex(sender))
      {
         auto pub = getSubjectPublicKeyInfo(row.key);
         auto claim =
             Claim{.service = VerifySig::service, .rawData = {pub.data.begin(), pub.data.end()}};
         keys.push_back({std::move(claim), std::move(row.key)});
      }
   }
   // Determine which keys are needed
   {
      auto checker = AuthChecker{actions};
      check(checker.checkAuth(getClaims(keys)), "Failed to sign transaction");
      for (auto iter = keys.begin(); iter != keys.end();)
      {
         if (checker.checkAuth(getClaims(keys, iter)))
         {
            iter = keys.erase(iter);
         }
         else
         {
            ++iter;
         }
      }
   }

   // Construct and sign transaction
   auto [refBlockIndex, refBlockSuffix] = to<Transact>().headTapos();
   Transaction trx{.tapos   = {.expiration = std::chrono::time_point_cast<Seconds>(
                                   std::chrono::system_clock::now() + std::chrono::seconds(3)),
                               .refBlockSuffix = refBlockSuffix,
                               .refBlockIndex  = refBlockIndex},
                   .actions = std::move(actions),
                   .claims  = getClaims(keys)};

   SignedTransaction signedTrx{.transaction{trx}};
   auto              hash = sha256(signedTrx.transaction.data(), signedTrx.transaction.size());
   for (const auto& [_, key] : keys)
   {
      auto proof = sign(key, hash);
      signedTrx.proofs.push_back({proof.begin(), proof.end()});
   }

   return signedTrx;
}

PSIBASE_DISPATCH(XKeys)
