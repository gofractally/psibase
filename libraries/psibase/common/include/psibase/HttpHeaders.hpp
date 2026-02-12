#pragma once

#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/SocketInfo.hpp>

namespace psibase
{
   struct QSplitSentinel
   {
   };
   struct QSplitIterator
   {
     public:
      using value_type      = std::string_view;
      using difference_type = std::ptrdiff_t;
      QSplitIterator(std::string_view s, char ch);
      std::string_view operator*() const { return {start, pos}; }
      friend bool      operator==(const QSplitIterator& lhs, const QSplitSentinel&)
      {
         return lhs.ch == '"';
      }
      QSplitIterator& operator++();
      QSplitIterator  operator++(int)
      {
         auto old = *this;
         ++*this;
         return old;
      }

     private:
      const char* start;
      const char* pos;
      const char* end;
      char        ch;
   };

   /// Splits a string_view at a separator char, but ignores the separator
   /// inside double-quotes. The separator must not be "
   struct QSplit
   {
     public:
      QSplit(std::string_view s, char ch) : s(s), ch(ch) {}
      QSplitIterator begin() const { return {s, ch}; }
      QSplitSentinel end() const { return {}; }

     private:
      std::string_view s;
      char             ch;
   };

   /// Parses the Forwarded and X-Forwarded-For headers
   /// and returns a list of IP addresses. Unparsable
   /// items and items that have a missing, opaque or
   /// unknown "for" field are represented as nullopt.
   std::vector<std::optional<IPAddress>> forwardedFor(const HttpRequest& request);
}  // namespace psibase
