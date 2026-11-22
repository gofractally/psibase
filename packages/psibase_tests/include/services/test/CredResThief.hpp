#pragma once

#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/nativeTables.hpp>
#include <services/system/Spki.hpp>
#include <services/user/tokenTypes.hpp>

namespace TestService
{

   struct CredIdRow
   {
      psibase::AccountNumber account;
      std::uint32_t          id;
      PSIO_REFLECT(CredIdRow, account, id)
   };
   using CredIdTable = psibase::Table<CredIdRow, &CredIdRow::account>;
   PSIO_REFLECT_TYPENAME(CredIdTable)

   struct BigDataRow
   {
      psibase::AccountNumber owner;
      std::vector<char>      data;
      PSIO_REFLECT(BigDataRow, owner, data)
   };
   using BigDataTable = psibase::Table<BigDataRow, &BigDataRow::owner>;
   PSIO_REFLECT_TYPENAME(BigDataTable)

   /// This service exploits the fact that Credentials checkAuthSys
   /// calls bill_to_sub and can be called by any service, to bill
   /// resources for a transaction using the resources of an
   /// arbitrary credential. Note that this requires access to the
   /// public key, which is not stored on chain (only the hash of
   /// the public key is stored), so it isn't quite as bad as it
   /// could be.
   struct CredResThief : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"cred-thief"};
      using Tables                  = psibase::ServiceTables<CredIdTable, BigDataTable>;
      // Creates a helper credential with the same key as the sender, so
      // that a single key will be able to authorize both the user and the
      // credential. The sender must use auth-sig.
      void create();
      // Buys resources for the sender's helper credential. These resources will not
      // actually be consumed, because billing is switched to a different
      // credential, but they may need to be present so the transaction doesn't
      // time out early.
      void buyRes(UserService::Quantity amount);
      // After setting up the service, call this action as the first action
      // in a transaction with cred-sys as the sender. This ensures that
      // cred-sys calling bill_to_sub has the intended effect.
      //
      // - key should be the public key of the target credential
      // - method should be any method that the target credential allows
      //
      // Further actions should be authorized by the user.
      void bill(SystemService::AuthSig::SubjectPublicKeyInfo key, psibase::ServiceMethod method);
      // Stores n bytes of data to the database
      void useDisk(std::uint32_t n);
   };
   PSIO_REFLECT(CredResThief,
                method(create),
                method(buyRes, amount),
                method(bill, key, method),
                method(useDisk, n));
   PSIBASE_REFLECT_TABLES(CredResThief, CredResThief::Tables)

}  // namespace TestService
