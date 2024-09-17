#include <psibase/block.hpp>

namespace psibase
{
   Checksum256 BlockInfo::makeBlockId(BlockHeader header)
   {
      header.authCode.reset();
      return sha256(header);
   }
}  // namespace psibase
