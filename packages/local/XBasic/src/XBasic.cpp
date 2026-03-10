#include <services/local/XBasic.hpp>

#include <botan/bcrypt.h>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <services/local/BasicAuth.hpp>
#include <services/local/XHttp.hpp>

using namespace psibase;
using namespace LocalService;

void XBasic::startSession()
{
   auto envTable = Native::session(KvMode::read).open<EnvTable>();

   std::optional<EnvRow> env;
   PSIBASE_SUBJECTIVE_TX
   {
      env = envTable.get(std::string("PSIBASE_PASSWD_FILE"));
   }
   if (!env)
      return;
   if (auto htpasswd = readFile(env->value))
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
   else
   {
      to<XHttp>().log(LogMessage::Severity::error,
                      "Failed to read password file " + env->value +
                          ". HTTP Basic Authentication will not be available.");
   }
}

AuthResult XBasic::checkAuth(const HttpRequest& req, std::optional<std::int32_t> socket)
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
                  return Auth::LocalUsername{std::move(row->username)};
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
                  return Auth::LocalUsername{std::move(row->username)};
               }
            }
         }
      }
   }
   return Auth::Unauthenticated{{"Basic realm=\"psibase\", charset=\"UTF-8\""}};
}

PSIBASE_DISPATCH(XBasic)
