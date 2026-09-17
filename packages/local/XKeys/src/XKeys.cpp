#include <services/local/XKeys.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/trace.hpp>
#include <services/local/XHttp.hpp>
#include <services/system/Spki.hpp>
#include <services/system/Transact.hpp>
#include <services/system/VerifySig.hpp>

using namespace psibase;
using namespace LocalService;
using namespace SystemService;
using SystemService::AuthSig::PrivateKeyInfo;

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
}  // namespace

Claim XKeys::newKey()
{
   auto sender = getSender();
   check(isLocal(sender), "service may not create keys");
   auto priv   = PrivateKeyInfo::create();
   auto pub    = getSubjectPublicKeyInfo(priv);
   auto result = Claim{.service = VerifySig::service, .rawData{pub.data.begin(), pub.data.end()}};
   auto table  = open<KeyTable>();
   auto row    = KeyRow{.id    = sha256(result.rawData.data(), result.rawData.size()),
                        .owner = sender,
                        .key   = std::move(priv)};
   PSIBASE_SUBJECTIVE_TX
   {
      table.put(row);
   }
   return result;
}

void XKeys::deleteKey(Claim key)
{
   auto id    = psibase::sha256(key.rawData.data(), key.rawData.size());
   auto table = open<KeyTable>();
   PSIBASE_SUBJECTIVE_TX
   {
      auto row = table.get(id);
      check(row && row->owner == getSender(), "Key not found");
      table.remove(*row);
   }
}

SignedTransaction XKeys::signTx(std::vector<psibase::Action> actions,
                                std::vector<psibase::Claim>  claims)
{
   auto sender = getSender();
   // Construct transaction
   auto [refBlockIndex, refBlockSuffix] = to<Transact>().headTapos();
   Transaction trx{.tapos   = {.expiration = std::chrono::time_point_cast<Seconds>(
                                   std::chrono::system_clock::now() + std::chrono::seconds(3)),
                               .refBlockSuffix = refBlockSuffix,
                               .refBlockIndex  = refBlockIndex},
                   .actions = std::move(actions),
                   .claims  = std::move(claims)};

   // Sign transaction
   auto              table = open<KeyTable>();
   SignedTransaction signedTrx{.transaction{trx}};
   auto              hash = sha256(signedTrx.transaction.data(), signedTrx.transaction.size());
   for (const auto& claim : claims)
   {
      check(claim.service == VerifySig::service, "wrong verify service");
      auto                  id = psibase::sha256(claim.rawData.data(), claim.rawData.size());
      std::optional<KeyRow> row;
      PSIBASE_SUBJECTIVE_TX
      {
         row = table.get(id);
      }
      check(row && row->owner == sender, "Key not found");
      auto proof = sign(row->key, hash);
      signedTrx.proofs.push_back({proof.begin(), proof.end()});
   }

   return signedTrx;
}

PSIBASE_DISPATCH(XKeys)
