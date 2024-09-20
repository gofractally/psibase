#pragma once

namespace psibase::snapshot
{
   struct SnapshotHeader
   {
      std::uint32_t magic   = 0x7388cf00;
      std::uint32_t version = 0;
   };
}  // namespace psibase::snapshot
