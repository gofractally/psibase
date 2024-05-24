#ifndef TRIEDENT_FUZZING_ENABLED

#include <cstdint>
#include <fstream>
#include <iostream>
#include <vector>

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size);

void runOne(std::istream& is, std::vector<char>& buf)
{
   buf.clear();
   char tmp[65536];
   do
   {
      is.read(tmp, sizeof(tmp));
      buf.insert(buf.end(), tmp, tmp + is.gcount());
   } while (is);
   LLVMFuzzerTestOneInput(reinterpret_cast<const std::uint8_t*>(buf.data()), buf.size());
}

int main(int argc, const char** argv)
{
   std::vector<char> buf;
   if (argc == 1)
   {
      runOne(std::cin, buf);
   }
   else
   {
      for (int i = 1; i < argc; ++i)
      {
         std::ifstream in{argv[i]};
         if (!in)
         {
            std::cout << "Failed to open file: " << argv[i] << std::endl;
            return 1;
         }
         else
         {
            runOne(in, buf);
         }
      }
   }
   return 0;
}

#endif
