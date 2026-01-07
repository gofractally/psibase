#pragma once

#include <psibase/Service.hpp>
#include <psibase/psibase.hpp>

namespace SystemService
{
   struct VirtualServer : public psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber("virtual-server");

      void useNetSys(psibase::AccountNumber user, uint64_t amount_bytes);
      void useCpuSys(psibase::AccountNumber user, std::chrono::nanoseconds amount_ns);
      void notifyBlock(psibase::BlockNum block_num);
      std::optional<uint64_t> getCpuLimit(psibase::AccountNumber account);
      uint8_t                 getMaxPeers();
   };

   PSIO_REFLECT(VirtualServer,
                method(useNetSys, user, amount_bytes),
                method(useCpuSys, user, cpuUsage),
                method(notifyBlock),
                method(getCpuLimit, account),
                method(getMaxPeers),
                //
   )

}  // namespace SystemService