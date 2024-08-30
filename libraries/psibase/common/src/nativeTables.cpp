#include <psibase/nativeTables.hpp>

#include <algorithm>

namespace psibase
{
   auto getCodeKeys(const std::vector<BlockHeaderAuthAccount>& services)
       -> std::vector<decltype(codeByHashKey(Checksum256(), 0, 0))>
   {
      std::vector<decltype(codeByHashKey(Checksum256(), 0, 0))> result;
      for (const auto& s : services)
      {
         result.push_back(codeByHashKey(s.codeHash, s.vmType, s.vmVersion));
      }
      std::sort(result.begin(), result.end());
      result.erase(std::unique(result.begin(), result.end()), result.end());
      return result;
   }
}  // namespace psibase
