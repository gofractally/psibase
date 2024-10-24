#include <psibase/KvMerkle.hpp>

#include <psibase/tester.hpp>
#include <string_view>

#include <catch2/catch.hpp>

using psibase::KvMerkle;

std::vector<char> operator""_x(const char* s, std::size_t n)
{
   std::vector<char> result;
   auto              get_digit = [](char ch)
   {
      if (ch >= '0' && ch <= '9')
         return ch - '0';
      else if (ch >= 'a' && ch <= 'f')
         return ch - 'a' + 10;
      else if (ch >= 'A' && ch <= 'F')
         return ch - 'A' + 10;
      else
         psibase::abortMessage("Not a hex digit");
   };
   while (n)
   {
      auto high = get_digit(*s);
      ++s;
      --n;
      if (!n)
         psibase::abortMessage("Unexpected end of hex string");
      auto low = get_digit(*s);
      result.push_back(low | (high << 4));
      ++s, --n;
   }
   return result;
}

TEST_CASE("Test KvMerkle empty")
{
   KvMerkle merkle;
   CHECK(std::move(merkle).root() == psibase::Checksum256{});
}

TEST_CASE("Test KvMerkle basic")
{
   KvMerkle       merkle;
   KvMerkle::Item item{""_x, ""_x};
   merkle.push(item);
   CHECK(std::move(merkle).root() == item.get_hash());
}

TEST_CASE("Test KvMerkle inner")
{
   KvMerkle       merkle;
   KvMerkle::Item item1{"aa"_x, ""_x};
   KvMerkle::Item item2{"bb"_x, ""_x};
   merkle.push(item1);
   merkle.push(item2);
   CHECK(item1.get_hash() != item2.get_hash());
   CHECK(std::move(merkle).root() == KvMerkle::combine(item1.get_hash(), item2.get_hash()));
}

TEST_CASE("Test KvMerkle prefix")
{
   KvMerkle       merkle;
   KvMerkle::Item item0{""_x, ""_x};
   KvMerkle::Item item1{"aa"_x, ""_x};
   KvMerkle::Item item2{"bb"_x, ""_x};
   merkle.push(item0);
   merkle.push(item1);
   merkle.push(item2);
   CHECK(
       std::move(merkle).root() ==
       KvMerkle::combine(item0.get_hash(), KvMerkle::combine(item1.get_hash(), item2.get_hash())));
}

psibase::Checksum256 as_node(const std::vector<KvMerkle::Item>& items, std::size_t i)
{
   return items[i].get_hash();
}

const psibase::Checksum256& as_node(auto&, const psibase::Checksum256& hash)
{
   return hash;
}

TEST_CASE("Test KvMerkle large")
{
   std::vector<KvMerkle::Item> items;
   items.emplace_back(""_x, ""_x);
   items.emplace_back("C0"_x, ""_x);
   items.emplace_back("C8"_x, ""_x);
   items.emplace_back("FC"_x, ""_x);
   items.emplace_back("FC00"_x, ""_x);
   KvMerkle merkle;
   for (const auto& item : items)
   {
      merkle.push(item);
   }
   auto n = [&](auto lhs, auto rhs)
   { return KvMerkle::combine(as_node(items, lhs), as_node(items, rhs)); };
   CHECK(std::move(merkle).root() == n(0, n(n(1, 2), n(3, 4))));
}
