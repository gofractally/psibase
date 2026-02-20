#pragma once

namespace psibase::detail
{
   // Used to convert a split_view element to a string_view.
   // Note that this is only needed when the standard library
   // doesn't implement P2210R2
   std::string_view split2sv(const auto& r)
   {
      auto data = &*r.begin();
      auto size = static_cast<std::size_t>(std::ranges::distance(r));
      return std::string_view{data, size};
   }
}  // namespace psibase::detail
