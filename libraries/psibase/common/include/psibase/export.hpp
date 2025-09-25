#pragma once

#include <psibase/api.hpp>

namespace psibase
{
   template <typename T>
   concept hasExport =
       requires(const T& t, std::vector<KvHandle>& handles) { psibaseExport(t, handles); };

   template <typename T>
   using exportType =
       decltype(psibaseExport(std::declval<const T&>(), std::declval<std::vector<KvHandle>&>()));
}  // namespace psibase
