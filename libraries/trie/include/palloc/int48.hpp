#pragma once

#include <cstdint>
#include <functional>
#include <ostream>

class int48_t final
{
  public:
   // default constructors
   int48_t() : _s(0) {}
   int48_t(const int48_t& obj)     = default;
   int48_t(int48_t&& obj) noexcept = default;

   // converter constructors
   int48_t(const std::int64_t i) : _s(i) {}

   int48_t(const std::uint64_t i) : _s(static_cast<std::int64_t>(i)) {}

   // default assigments
   int48_t& operator=(const int48_t& obj) = default;
   int48_t& operator=(int48_t&& obj) noexcept = default;

   // converter assigments
   int48_t& operator=(std::int64_t i)
   {
      _s = i;
      return *this;
   }

   int48_t& operator=(std::uint64_t i)
   {
      _s = static_cast<std::int64_t>(i);
      return *this;
   }

   // cast operators
   operator std::int64_t() const { return _s; }
   operator bool() const { return _s!=0; }

   operator std::uint64_t() const { return static_cast<std::uint64_t>(_s); }

   // comparison
   bool operator==(const int48_t& obj) const { return _s == obj._s; }

   bool operator!=(const int48_t& obj) const { return _s != obj._s; }

   friend bool operator<=(const std::int64_t i, const int48_t& obj);
   friend bool operator<=(const int48_t& obj, const std::int64_t i);

   friend bool operator>(auto i, const int48_t& obj);
   friend bool operator>(const int48_t& obj, auto i);

   friend bool operator==(const std::int64_t i, const int48_t& obj);
   friend bool operator==(const int48_t& obj, const std::int64_t i);

   friend bool operator!=(const std::int64_t i, const int48_t& obj);
   friend bool operator!=(const int48_t& obj, const std::int64_t i);

   // printing
   friend std::ostream& operator<<(std::ostream& stream, const int48_t& obj);

  private:
   std::int64_t _s : 48;
} __attribute__((packed));

static_assert(sizeof(int48_t) == 6, "size of int48_t is not 48bit, check your compiler!");
static_assert(sizeof(int48_t[2]) == 12, "size of int48_t[2] is not 2*48bit, check your compiler!");
static_assert(sizeof(int48_t[3]) == 18, "size of int48_t[3] is not 3*48bit, check your compiler!");
static_assert(sizeof(int48_t[4]) == 24, "size of int48_t[4] is not 4*48bit, check your compiler!");

inline std::ostream& operator<<(std::ostream& stream, const int48_t& obj)
{
   stream << obj._s;
   return stream;
}

inline bool operator<=(const std::int64_t i, const int48_t& obj)
{
   return i <= obj._s;
}

inline bool operator<=(const int48_t& obj, const std::int64_t i)
{
   return i <= obj._s;
}

inline bool operator>(auto i, const int48_t& obj)
{
   return i > obj._s;
}

inline bool operator>(const int48_t& obj, auto i)
{
   return i > obj._s;
}

inline bool operator==(const std::int64_t i, const int48_t& obj)
{
   return i == obj._s;
}

inline bool operator==(const int48_t& obj, const std::int64_t i)
{
   return i == obj._s;
}

inline bool operator!=(const std::int64_t i, const int48_t& obj)
{
   return i != obj._s;
}

inline bool operator!=(const int48_t& obj, const std::int64_t i)
{
   return i != obj._s;
}

namespace std
{
   template <>
   struct hash<int48_t>
   {
      size_t operator()(const int48_t& obj) const
      {
         // XXX: implement fast path
         return _helper(static_cast<std::int64_t>(obj));
      }

      std::hash<std::int64_t> _helper;
   };
}  // namespace std
