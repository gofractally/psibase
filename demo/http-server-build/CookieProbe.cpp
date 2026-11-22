#include <psibase/Service.hpp>
#include <psibase/Rpc.hpp>
#include <psibase/dispatch.hpp>
#include <psio1/to_json.hpp>

struct CookieProbe : psibase::Service
{
   static constexpr auto service = psibase::AccountNumber{"cookietest"};
   std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest req,
                                              std::optional<std::int32_t> socket,
                                              std::optional<psibase::AccountNumber> user);
};
PSIO_REFLECT(CookieProbe, method(serveSys, req, socket, user))
PSIBASE_REFLECT_TABLES(CookieProbe)

struct ProbeResult
{
   std::optional<psibase::AccountNumber> user;
   bool authorization = false;
   bool sessionCookie = false;
   std::vector<std::string> theme;
   std::vector<std::string> appSession;
};
PSIO_REFLECT(ProbeResult, user, authorization, sessionCookie, theme, appSession)

std::optional<psibase::HttpReply> CookieProbe::serveSys(
    psibase::HttpRequest req, std::optional<std::int32_t>,
    std::optional<psibase::AccountNumber> user)
{
   if (req.method != "GET") return {};
   ProbeResult result{.user = user};
   for (const auto& header : req.headers)
   {
      result.authorization |= header.matches("authorization");
      if (header.matches("cookie"))
      {
         result.sessionCookie |= header.value.find("__Host-SESSION") != std::string::npos
                                 || header.value.find("__HOST-SESSION") != std::string::npos;
         psibase::HttpRequest single{.headers = {header}};
         for (auto value : single.getCookie("SESSION")) result.sessionCookie = true;
         for (auto value : single.getCookie("theme")) result.theme.emplace_back(value);
         for (auto value : single.getCookie("session")) result.appSession.emplace_back(value);
      }
   }
   auto json = psio1::convert_to_json(result);
   return psibase::HttpReply{.contentType = "application/json", .body = {json.begin(), json.end()}};
}
PSIBASE_DISPATCH(CookieProbe)
