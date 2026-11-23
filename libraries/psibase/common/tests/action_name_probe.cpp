// Batch conformance driver: one identifier/hash literal per input line.
#include <charconv>
#include <iostream>
#include <psio/action_name.hpp>

int main(int argc, char** argv)
{
   if (argc == 2 && std::string_view(argv[1]) == "--model-hash")
   {
      std::cout << psio::action_names::model_sha256 << '\n';
      return 0;
   }
   const bool  decode = argc == 2 && std::string_view(argv[1]) == "--decode";
   std::string input;
   while (std::getline(std::cin, input))
   {
      if (!input.empty() && input.back() == '\r')
         input.pop_back();
      if (decode)
      {
         uint64_t value  = 0;
         auto     parsed = std::from_chars(input.data(), input.data() + input.size(), value);
         auto     text   = parsed.ec == std::errc{} && parsed.ptr == input.data() + input.size()
                               ? psio::action_names::try_decode(value)
                               : std::nullopt;
         if (!text)
            std::cout << input << "\tINVALID\n";
         else
            std::cout << input << '\t' << *text << '\t' << psio::action_names::encode(*text)
                      << '\n';
      }
      else
      {
         auto value = psio::action_names::try_encode(input);
         if (!value)
            std::cout << input << "\tINVALID\n";
         else
         {
            auto text = psio::action_names::try_decode(*value);
            if (!text)
               return 2;
            std::cout << input << '\t' << *value << '\t' << *text << '\t'
                      << psio::action_names::is_hash(*value) << '\n';
         }
      }
   }
}
