#include <eosio/from_bin.hpp>
#include <newchain/contract.hpp>

namespace newchain
{
   std::vector<char> get_result(uint32_t size)
   {
      std::vector<char> result(size);
      if (size)
         intrinsic::get_result(result.data(), result.size());
      return result;
   }

   std::vector<char> get_result() { return get_result(intrinsic::get_result(nullptr, 0)); }

   action get_current_action()
   {
      auto data = get_result(intrinsic::get_current_action());
      return eosio::convert_from_bin<action>(data);
   }

   std::vector<char> call(const action& action)
   {
      auto bin = eosio::convert_to_bin(action);
      return get_result(intrinsic::call(bin.data(), bin.size()));
   }
}  // namespace newchain
