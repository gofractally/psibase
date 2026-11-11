#include "reply_headers.hpp"

#include <boost/beast/http/empty_body.hpp>
#include <boost/beast/http/message.hpp>
#include <catch2/catch_all.hpp>
#include <psibase/HttpHeaders.hpp>
#include <vector>

using namespace psibase;
using namespace psibase::http;
namespace bhttp = boost::beast::http;

namespace
{
   bhttp::response<bhttp::empty_body> responseWith(std::vector<HttpHeader> headers)
   {
      bhttp::response<bhttp::empty_body> res{bhttp::status::ok, 11};
      for (auto& header : headers)
         mergeSetCookie(res, header);
      return res;
   }

   std::vector<std::string> headerValues(const bhttp::response<bhttp::empty_body>& res,
                                         std::string_view                          name)
   {
      std::vector<std::string> values;
      for (auto const& field : res)
      {
         if (iequal(field.name_string(), name))
            values.emplace_back(field.value());
      }
      return values;
   }
}  // namespace

TEST_CASE("later set-cookie for the same name replaces")
{
   auto res = responseWith({
       {"Set-Cookie", "a=1; Path=/"},
       {"Set-Cookie", "b=2; Path=/"},
       {"set-cookie", "a=3; Path=/other; HttpOnly"},
   });
   CHECK(headerValues(res, "set-cookie") ==
         std::vector<std::string>{"b=2; Path=/", "a=3; Path=/other; HttpOnly"});
}
