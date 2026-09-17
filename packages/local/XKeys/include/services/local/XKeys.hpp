#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/nativeTables.hpp>
#include <services/system/PrivateKeyInfo.hpp>

namespace LocalService
{
   struct KeyRow
   {
      // sha256(spki)
      psibase::Checksum256                   id;
      psibase::AccountNumber                 owner;
      SystemService::AuthSig::PrivateKeyInfo key;
      PSIO_REFLECT(KeyRow, id, owner, key)
   };
   using KeyTable = psibase::Table<KeyRow, &KeyRow::id>;
   PSIO_REFLECT_TYPENAME(KeyTable)

   struct TxCallbackRow
   {
      std::int32_t           socket;
      psibase::ServiceMethod callback;
      PSIO_REFLECT(TxCallbackRow, socket, callback)
   };
   using TxCallbackTable = psibase::Table<TxCallbackRow, &TxCallbackRow::socket>;
   PSIO_REFLECT_TYPENAME(TxCallbackTable)

   struct XKeys : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-keys"};
      using Subjective              = psibase::SubjectiveTables<KeyTable, TxCallbackTable>;

      /// Creates a new key pair and returns the public key.
      /// The key can only be used by the caller
      psibase::Claim newKey();

      /// Deletes a private key
      /// The key must have been created by the caller
      void deleteKey(psibase::Claim key);

      /// Signs and pushes a transaction.
      ///
      /// Returns the socket associated with the transaction
      ///
      /// All the keys must have been created by the caller
      ///
      /// `setCallback` should be used after this to receive
      /// a notification when the transaction is final
      ///
      /// TODO: Look up required claims by action sender
      std::int32_t asyncPushTx(std::vector<psibase::Action> actions,
                               std::vector<psibase::Claim>  keys);

      /// Sets a callback to be run when the transaction completes. The socket
      /// must have previously been opened with `asyncPushTx`.
      ///
      /// ```
      /// void callback(std::int32_t socket, std::optional<TransactionTrace> trace);
      /// ```
      ///
      /// If the trace is available it indicates whether the transaction succeeded.
      /// If the trace is missing, the status of the transaction is unknown. Network
      /// or server errors can occur either before or after the transaction is applied.
      ///
      /// May be called inside `PSIBASE_SUBJECTIVE_TX`
      void setCallback(std::int32_t socket, psibase::MethodNumber callback);

      void onTx(std::int32_t socket, const psibase::HttpReply& reply);
      void errTx(std::int32_t socket);
   };
   PSIO_REFLECT(XKeys,
                method(newKey),
                method(deleteKey, key),
                method(asyncPushTx, actions, keys),
                method(setCallback, socket, callback),
                method(onTx, socket, reply),
                method(errTx, socket))
   PSIBASE_REFLECT_TABLES(XKeys, XKeys::Subjective)
}  // namespace LocalService
