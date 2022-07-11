#pragma once

#include <psibase/Contract.hpp>
#include <psibase/nativeTables.hpp>

namespace system_contract
{
   struct AuthInterface
   {
      // TODO: return error message instead?
      void checkAuthSys(psibase::Action action, std::vector<psibase::Claim> claims);
   };
   PSIO_REFLECT(AuthInterface, method(checkAuthSys, action, claims))

   struct TransactionSys : psibase::Contract<TransactionSys>
   {
      static constexpr auto     contract = psibase::AccountNumber("transact-sys");
      static constexpr uint64_t contractFlags =
          psibase::AccountRow::allowSudo | psibase::AccountRow::allowWriteNative;

      void startBlock();

      // TODO: currentBlockNum(), currentBlockTime(): fetch from new status fields
      //       also update contracts which use `head + 1`
      psibase::BlockNum     headBlockNum() const;
      psibase::TimePointSec headBlockTime() const;

      // TODO: move to another contract
      uint8_t setCode(psibase::AccountNumber contract,
                      uint8_t                vmType,
                      uint8_t                vmVersion,
                      std::vector<char>      code);
   };

   PSIO_REFLECT(TransactionSys,
                method(startBlock),
                method(setCode, contact, vmType, vmVersion, code),
                method(headBlockNum),
                method(headBlockTime))
}  // namespace system_contract
