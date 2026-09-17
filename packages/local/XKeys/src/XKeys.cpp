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
   struct CallbackArgs
   {
      std::optional<psio::view<const TransactionTrace>> trace;
      PSIO_REFLECT(CallbackArgs, trace)
   };

   void doCallback(std::int32_t socket, CallbackArgs args)
   {
      auto          table = XKeys{}.open<TxCallbackTable>();
      ServiceMethod callback;
      PSIBASE_SUBJECTIVE_TX
      {
         auto row = table.get(socket).value();
         callback = row.callback;
         table.remove(row);
      }
      call(Action{.sender  = getReceiver(),
                  .service = callback.service,
                  .method  = callback.method,
                  .rawData = psio::to_frac(args)});
   }
}  // namespace

Claim XKeys::newKey()
{
   auto sender = getSender();
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

void XKeys::asyncPushTx(std::vector<psibase::Action> actions,
                        std::vector<psibase::Claim>  claims,
                        MethodNumber                 completionCallback)
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

   // Submit transaction
   HttpRequest req{
       .host        = "transact.psibase.localhost:8080",
       .method      = "POST",
       .target      = "/push_transaction?wait_for=final",
       .contentType = "application/octet-stream",
       .headers     = {{"Accept", "application/octet-stream"}},
       .body        = psio::to_frac(signedTrx),
   };
   auto sock      = to<XHttp>().sendRequest(req, std::nullopt, std::nullopt);
   auto callbacks = open<TxCallbackTable>();
   PSIBASE_SUBJECTIVE_TX
   {
      to<XHttp>().setCallback(sock, MethodNumber{"onTx"}, MethodNumber{"errTx"});
      callbacks.put({sock, {.service = sender, .method = completionCallback}});
   }
}

void XKeys::onTx(std::int32_t socket, const HttpReply& reply)
{
   check(getSender() == HttpServer::service, "Wrong sender");
   if (reply.status == HttpStatus::ok)
   {
      if (reply.contentType == "application/octet-stream" &&
          psio::fracpack_validate_compatible<TransactionTrace>(reply.body))
      {
         doCallback(socket, {.trace = psio::view<const TransactionTrace>{reply.body}});
      }
      else
      {
         doCallback(socket, {});
      }
   }
   else
   {
      doCallback(socket, {});
   }
}

void XKeys::errTx(std::int32_t socket)
{
   check(getSender() == HttpServer::service, "Wrong sender");
   doCallback(socket, {});
}

PSIBASE_DISPATCH(XKeys)
