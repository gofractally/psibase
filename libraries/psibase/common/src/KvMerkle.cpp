#include <psibase/KvMerkle.hpp>

#include <psibase/RawNativeFunctions.hpp>

namespace
{
   std::size_t common_prefix_bits(unsigned char lhs, unsigned char rhs)
   {
      unsigned x = lhs ^ rhs;
      if (x == 0)
         return 8;
      else
         return __builtin_clz(x) - (std::numeric_limits<unsigned>::digits - 8);
   }
   std::size_t common_prefix_bits(std::span<const unsigned char> lhs,
                                  std::span<const unsigned char> rhs)
   {
      auto len = std::min(lhs.size(), rhs.size());
      for (std::size_t i = 0; i < len; ++i)
      {
         if (lhs[i] != rhs[i])
         {
            psibase::check(lhs[i] < rhs[i], "Keys must be inserted in increasing order");
            return i * 8 + common_prefix_bits(lhs[i], rhs[i]);
         }
      }
      psibase::check(len < rhs.size(), "Keys must be inserted in increasing order");
      return len * 8;
   }
   std::size_t get_stack_after(std::span<const unsigned char> key, std::size_t n)
   {
      std::size_t i = n / 8;
      if (i == key.size())
         return 0;
      std::size_t result = 1 + std::popcount(key[i] & (0xffu >> (n % 8)));
      ++i;
      for (; i != key.size(); ++i)
      {
         result += 1 + std::popcount(key[i]);
      }
      return result;
   }
   std::size_t get_stack_size(std::span<const unsigned char> key)
   {
      std::size_t result = 1 + key.size();
      for (unsigned char b : key)
      {
         result += std::popcount(b);
      }
      return result;
   }
}  // namespace

namespace psibase
{
   KvMerkle::Item::Item() : data{0} {}
   KvMerkle::Item::Item(std::span<const unsigned char> key, std::span<const unsigned char> value)
   {
      std::uint32_t keySize   = key.size();
      std::uint32_t valueSize = value.size();
      data.resize(9 + keySize + valueSize);
      std::memcpy(data.data() + 1, &keySize, 4);
      std::memcpy(data.data() + 5, key.data(), keySize);
      std::memcpy(data.data() + 5 + keySize, &valueSize, 4);
      std::memcpy(data.data() + 9 + keySize, value.data(), valueSize);
   }
   void KvMerkle::Item::fromResult(std::uint32_t valueSize)
   {
      std::uint32_t keySize = psibase::raw::getKey(nullptr, 0);
      data.resize(9 + keySize + valueSize);
      std::memcpy(data.data() + 1, &keySize, 4);
      psibase::raw::getKey(reinterpret_cast<char*>(data.data()) + 5, keySize);
      std::memcpy(data.data() + 5 + keySize, &valueSize, 4);
      psibase::raw::getResult(reinterpret_cast<char*>(data.data()) + 9 + keySize, valueSize, 0);
   }
   std::span<const unsigned char> KvMerkle::Item::key() const
   {
      std::uint32_t keySize;
      std::memcpy(&keySize, data.data() + 1, 4);
      return std::span{data.data() + 5, keySize};
   }
   Checksum256 KvMerkle::Item::get_hash() const
   {
      return sha256(data.data(), data.size());
   }

   Checksum256 KvMerkle::root() &&
   {
      if (stack.empty())
         return {};
      pop_n(stack.size() - 1);
      auto result = stack.back();
      stack.clear();
      current_key.clear();
      return result;
   }
   void KvMerkle::push(const Item& item)
   {
      push_hash(item.key(), item.get_hash());
   }
   void KvMerkle::push_hash(std::span<const unsigned char> key, const Checksum256& value)
   {
      if (stack.empty())
      {
         if (key.empty())
         {
            stack.push_back(value);
            return;
         }
         else
         {
            stack.push_back(Checksum256{});
         }
      }
      auto        n              = common_prefix_bits(current_key, key);
      std::size_t bits_to_remove = get_stack_after(current_key, n);
      std::size_t bits_to_add    = get_stack_after(key, n);
      std::size_t new_stack_size = stack.size() - bits_to_remove + bits_to_add;
      if (bits_to_remove)
         pop_n(bits_to_remove - 1);
      assert(stack.size() < new_stack_size);
      stack.resize(new_stack_size);
      stack.back() = value;
      // make current_key = key
      std::size_t bytes_kept = n / 8;
      current_key.resize(bytes_kept);
      auto new_key_part = key.subspan(bytes_kept);
      current_key.insert(current_key.end(), new_key_part.begin(), new_key_part.end());
      // sanity check
      assert(get_stack_size(current_key) == stack.size());
   }
   Checksum256 KvMerkle::combine(const Checksum256& lhs, const Checksum256& rhs)
   {
      if (lhs == Checksum256{})
         return rhs;
      if (rhs == Checksum256{})
         return lhs;
      return Merkle::combine(lhs, rhs);
   }
   void KvMerkle::pop_n(std::size_t n)
   {
      auto top = stack.back();
      stack.pop_back();
      for (std::size_t i = 0; i < n; ++i)
      {
         auto node = stack.back();
         top       = combine(node, top);
         stack.pop_back();
      }
      stack.push_back(top);
   }
}  // namespace psibase
