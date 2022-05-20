#pragma once

#include <fcntl.h>
#include <filesystem>
#include <string>
#include <utility>

class tmp_file
{
  public:
   tmp_file()
       : _fd(::open(std::filesystem::temp_directory_path().c_str(), O_RDWR | O_TMPFILE | O_EXCL))
   {
   }
   ~tmp_file() { ::close(_fd); }
   int native_handle() { return _fd; }

  private:
   int _fd;
};

auto make_kv(int i)
{
   return std::pair{std::to_string(i), std::to_string(i * 1024)};
}

template <typename T, typename U>
std::ostream& operator<<(std::ostream& os, const std::pair<T, U>& p)
{
   return os << "{ " << p.first << ", " << p.second << " }";
}

#define CHECK_CURSOR(cursor, k, v)         \
   do                                      \
   {                                       \
      CHECK(cursor.valid());               \
      if (cursor.valid())                  \
      {                                    \
         CHECK(cursor.get_key() == (k));   \
         CHECK(cursor.get_value() == (v)); \
      }                                    \
   } while (false)
