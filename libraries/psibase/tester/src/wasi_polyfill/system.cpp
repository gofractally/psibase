#include <cstdint>
#include <cstring>

extern "C"
{
   [[clang::import_name("testerExecute")]] std::int32_t testerExecute(const char*   command,
                                                                      std::uint32_t command_size);
   int                                                  system(const char* command)
   {
      return testerExecute(command, std::strlen(command));
   }
}
