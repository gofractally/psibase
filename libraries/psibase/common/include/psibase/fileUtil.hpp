#pragma once

#include <string_view>
#include <vector>

namespace psibase
{
   std::vector<char> readWholeFile(std::string_view filename);
}
