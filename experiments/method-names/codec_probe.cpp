// Read-only batch probe of the repository's current C++ method-name codec.
// Input: one name per line. Output TSV: input, u64, decoded, hash flag.
#include <algorithm>
#include <iostream>
#include <string>
#include <psio/compress_name.hpp>

int main()
{
   std::string name;
   while (std::getline(std::cin, name))
   {
      if (!name.empty() && name.back() == '\r')
         name.pop_back();
      const auto value = psio::detail::method_to_number(name);
      std::cout << name << '\t' << value << '\t'
                << psio::detail::number_to_method(value) << '\t'
                << (psio::detail::is_hash_name(value) ? 1 : 0) << '\n';
   }
}
