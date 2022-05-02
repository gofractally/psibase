#include <psibase/intrinsic.hpp>

#include <psio/from_bin.hpp>

namespace psibase
{
   std::vector<char> get_result(uint32_t size)
   {
      std::vector<char> result(size);
      if (size)
         raw::get_result(result.data(), result.size(), 0);
      return result;
   }

   std::vector<char> get_result()
   {
      return get_result(raw::get_result(nullptr, 0, 0));
   }

   std::vector<char> get_key(uint32_t size)
   {
      std::vector<char> key(size);
      if (size)
         raw::get_key(key.data(), key.size());
      return key;
   }

   std::vector<char> get_key()
   {
      return get_key(raw::get_key(nullptr, 0));
   }

   Action get_current_action()
   {
      auto data = get_result(raw::get_current_action());
      return psio::convert_from_frac<Action>(data);
   }

   psio::shared_view_ptr<Action> get_current_action_view()
   {
      psio::shared_view_ptr<Action> ptr(psio::size_tag{raw::get_current_action()});
      raw::get_result(ptr.data(), ptr.size(), 0);
      check(ptr.validate_all_known(), "invalid action format");
      return ptr;
   }

   std::vector<char> call(const char* action, uint32_t len)
   {
      return get_result(raw::call(action, len));
   }

   std::vector<char> call(psio::input_stream action)
   {
      return get_result(raw::call(action.pos, action.remaining()));
   }

   std::vector<char> call(const Action& action)
   {
      return call(psio::convert_to_frac(action));
   }
}  // namespace psibase
