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

      using ByOwner = psibase::CompositeKey<&KeyRow::owner, &KeyRow::id>;
      PSIO_REFLECT(KeyRow, id, owner, key)
   };
   using KeyTable = psibase::Table<KeyRow, KeyRow::ByOwner{}>;
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
      /// All the required keys myst have been created by the caller
      psibase::SignedTransaction signTx(std::vector<psibase::Action> actions);
   };
   PSIO_REFLECT(XKeys, method(newKey), method(deleteKey, key), method(signTx, actions))
   PSIBASE_REFLECT_TABLES(XKeys, XKeys::Subjective)
}  // namespace LocalService
