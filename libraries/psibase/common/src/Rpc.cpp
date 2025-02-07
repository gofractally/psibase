#include <psibase/Rpc.hpp>

#include <ranges>

namespace
{
   template <typename Iter>
   char read_pct(Iter& iter, Iter end)
   {
      auto read_digit = [&]
      {
         ++iter;
         if (iter != end)
         {
            if (*iter >= '0' && *iter <= '9')
               return *iter - '0';
            else if (*iter >= 'a' && *iter <= 'f')
               return *iter - 'a' + 10;
            else if (*iter >= 'A' && *iter <= 'F')
               return *iter - 'A' + 10;
         }
         psibase::abortMessage("Invalid pct-encoded");
      };
      auto upper = read_digit();
      auto lower = read_digit();
      return (upper << 4) | lower;
   }

   std::string decode_pct(std::string_view s)
   {
      std::string result;
      for (auto iter = s.begin(), end = s.end(); iter != end; ++iter)
      {
         if (*iter == '%')
            result += read_pct(iter, end);
         else
            result += *iter;
      }
      return result;
   }
}  // namespace

namespace psibase
{
   bool HttpHeader::matches(std::string_view h) const
   {
      return std::ranges::equal(name, h, {}, ::tolower, ::tolower);
   }

   std::pair<std::string, std::string> HttpRequest::readQueryItem(std::string_view& query)
   {
      auto end   = query.find('&');
      auto split = query.substr(0, end).find('=');

      auto key   = query.substr(0, split);
      auto value = split > end ? std::string_view{} : query.substr(split + 1, end - split - 1);

      if (end == std::string_view::npos)
      {
         query.remove_prefix(query.size());
      }
      else
      {
         query.remove_prefix(end + 1);
      }
      return {decode_pct(key), decode_pct(value)};
   }

   std::string HttpRequest::path() const
   {
      return decode_pct(std::string_view(target).substr(0, target.find('?')));
   }

   std::optional<std::string_view> HttpRequest::getCookie(std::string_view name) const
   {
      for (const auto& header : headers)
      {
         if (std::ranges::equal(header.name, std::string_view{"cookie"}, {}, ::tolower))
         {
            for (auto kvrange : header.value | std::views::split(';'))
            {
               std::string_view kv(kvrange.begin(), kvrange.end());
               auto             pos = kv.find('=');
               check(pos != std::string_view::npos, "Invalid cookie");
               auto key   = kv.substr(kv.find_first_not_of(" \t"), pos);
               auto value = kv.substr(pos + 1);
               if (key == name)
                  return value;
            }
         }
      }
      return {};
   }

   void HttpRequest::removeCookie(std::string_view name)
   {
      for (auto& header : headers)
      {
         if (std::ranges::equal(header.name, std::string_view{"cookie"}, {}, ::tolower))
         {
            auto out   = header.value.begin();
            bool first = true;
            for (auto kvrange : header.value | std::views::split(';'))
            {
               std::string_view kv(kvrange.begin(), kvrange.end());
               auto             pos     = kv.find('=');
               bool             matched = false;
               if (pos != std::string_view::npos)
               {
                  auto key   = kv.substr(kv.find_first_not_of(" \t"), pos);
                  auto value = kv.substr(pos + 1);
                  matched    = key == name;
               }
               if (!matched)
               {
                  if (first)
                     first = false;
                  else
                     *out++ = ';';
                  std::ranges::copy(kv, out);
               }
            }
            header.value.resize(out - header.value.begin());
         }
      }
   }
}  // namespace psibase
