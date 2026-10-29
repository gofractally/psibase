#pragma once

#include <span>
#include <vector>

namespace psibase
{
   template <typename Body>
   struct BasicHttpRequest;

   using HttpRequest    = BasicHttpRequest<std::vector<char>>;
   using HttpRequestRef = BasicHttpRequest<std::span<const char>>;
}  // namespace psibase
