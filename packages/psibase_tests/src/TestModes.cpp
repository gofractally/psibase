#include <services/test/TestModes.hpp>

#include <psibase/dispatch.hpp>
#include <psio/json.hpp>

using namespace psibase;
using namespace TestService;

std::uint32_t TestModes::declared(std::string text)
{
   return text.size();
}

void TestModes::store(std::uint32_t id, std::string text)
{
   Tables{}.open<NoteTable>().put(NoteRow{id, std::move(text)});
}

void TestModes::storeChecked(std::uint32_t id, std::string text)
{
   auto bytes = psio::to_pssz_checked(NoteRow{id, std::move(text)});
   Tables{}.open<NoteTable>().put(psio::pssz_view<NoteRow>{bytes});
}

std::uint32_t TestModes::length(std::uint32_t id)
{
   auto row = Tables{}.open<NoteTable>().getIndex<0>().get(id);
   check(row.has_value(), "no such note");
   return row->text.size();
}

bool TestModes::valid(std::uint32_t id)
{
   auto row = Tables{}.open<NoteTable>().getIndex<0>().getView(id);
   check(row.has_value(), "no such note");
   return psio::validate_pssz<NoteRow>(row->bytes()).ok();
}

std::optional<HttpReply> TestModes::serveSys(const HttpRequest& request)
{
   if (request.method == "POST" && request.target == "/note")
   {
      auto row = psio::from_ijson<NoteRow>(request.body);
      HttpReply reply{.contentType = "application/json"};
      psio::to_ijson(row.id, reply.body);
      return reply;
   }
   return {};
}

PSIBASE_DISPATCH(TestModes)
