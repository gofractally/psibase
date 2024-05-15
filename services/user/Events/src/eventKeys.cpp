#include "eventKeys.hpp"

#include <psibase/check.hpp>
#include <ranges>

using namespace psibase;

namespace UserService
{

   std::uint64_t keyToEventId(const std::vector<char>& key, std::size_t prefixLen)
   {
      std::uint64_t result = 0;
      // The last 8 bytes of the key are the row id (big endian)
      if (key.size() < sizeof(result) + prefixLen)
         abortMessage("Key too small");
      for (std::uint8_t digit : std::ranges::subrange(key.end() - sizeof(result), key.end()))
      {
         result = (result << 8) | digit;
      }
      return result;
   }

}  // namespace UserService
