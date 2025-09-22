#pragma once

#include <psibase/Service.hpp>
#include <psibase/block.hpp>
#include <psibase/nativeTables.hpp>

namespace TestService
{
   struct AsRpc : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"as-rpc"};
      static constexpr auto flags   = psibase::CodeRow::isPrivileged;
      void                  asRpc(psibase::Action action);
   };
   PSIO_REFLECT(AsRpc, method(asRpc, action))
}  // namespace TestService
