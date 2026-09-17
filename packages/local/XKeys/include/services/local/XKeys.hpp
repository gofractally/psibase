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

   struct XKeys : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-keys"};
      using Subjective              = psibase::SubjectiveTables<KeyTable>;

      /// Creates a new key pair and returns the public key.
      /// The key can only be used by the caller
      psibase::Claim newKey();

      /// Deletes a private key
      /// The key must have been created by the caller
      void deleteKey(psibase::Claim key);

      /// Signs a transaction.
      ///
      /// All the keys must have been created by the caller
      ///
      /// TODO: Look up required claims by action sender
      psibase::SignedTransaction signTx(std::vector<psibase::Action> actions,
                                        std::vector<psibase::Claim>  keys);
   };
   PSIO_REFLECT(XKeys, method(newKey), method(deleteKey, key), method(signTx, actions, keys))
   PSIBASE_REFLECT_TABLES(XKeys, XKeys::Subjective)
}  // namespace LocalService
