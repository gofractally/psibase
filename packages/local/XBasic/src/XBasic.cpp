#include <services/local/XBasic.hpp>

#include <botan/bcrypt.h>
#include <psibase/dispatch.hpp>
#include <services/local/BasicAuth.hpp>

using namespace psibase;
using namespace LocalService;

void XBasic::startSession()
{
   if (auto htpasswd = readFile("/psibase/.htpasswd"))
   {
      auto passwords = open<PasswordTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         for (auto r : *htpasswd | std::views::split('\n'))
         {
            std::string_view line(r);
            auto             pos = line.find(':');
            if (pos != std::string_view::npos)
            {
               passwords.put({std::string(line.substr(0, pos)), std::string(line.substr(pos + 1))});
            }
         }
      }
   }
}

std::optional<HttpReply> XBasic::checkAuth(const HttpRequest&          req,
                                           std::optional<std::int32_t> socket)
{
   if (auto header = req.getHeader("authorization"))
   {
      if (auto auth = parseBasicAuth(*header))
      {
         auto                       passwords = open<PasswordTable>();
         std::optional<PasswordRow> row;
         PSIBASE_SUBJECTIVE_TX
         {
            row = passwords.get(std::string(auth->username()));
         }
         if (row)
         {
            if (row->password)
            {
               if (*row->password == auth->password())
                  return std::nullopt;
            }
            else
            {
               if (Botan::check_bcrypt(auth->password(), row->hash))
               {
                  row->password = auth->password();
                  PSIBASE_SUBJECTIVE_TX
                  {
                     passwords.put(*row);
                  }
                  return std::nullopt;
               }
            }
         }
      }
   }
   return HttpReply{.status = HttpStatus::unauthorized};
}

PSIBASE_DISPATCH(XBasic)
