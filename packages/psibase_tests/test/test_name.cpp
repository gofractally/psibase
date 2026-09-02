#include <psibase/NameEncoder.hpp>

#include <algorithm>
#include <ranges>
#include <string_view>
#include <vector>

#include <catch2/catch_test_macros.hpp>

template <std::size_t maxlen>
struct Encoding
{
   std::string_view        chars;
   std::size_t             sep;
   constexpr std::uint64_t encode(std::string_view name) const
   {
      psibase::NameEncoder<std::uint64_t, maxlen> encoder{chars.size() - 1};
      return encoder.encode(
          name | std::views::transform([this](char ch) { return chars.find(ch); }), sep);
   }

   constexpr std::string decode(std::uint64_t value)
   {
      psibase::NameEncoder<std::uint64_t, maxlen> encoder{chars.size() - 1};
      std::string                                 result;
      encoder.decode(value, sep, [&](std::size_t idx) { result.push_back(chars[idx]); });
      return result;
   }
   std::uint64_t max() const
   {
      psibase::NameEncoder<std::uint64_t, maxlen> encoder{chars.size() - 1};
      return encoder.max();
   }
   bool isValid(std::string_view s) const
   {
      if (s.empty())
         return true;
      if (s.size() > maxlen)
         return false;
      if (s.find_first_not_of(chars) != std::string_view::npos)
         return false;
      bool hasSep = true;
      for (char ch : s)
      {
         if (ch == chars[sep])
         {
            if (hasSep)
               return false;
            hasSep = true;
         }
         else
         {
            hasSep = false;
         }
      }
      return !hasSep;
   }
   void generate(std::string& buf, std::vector<std::string>& out, std::size_t i = 0)
   {
      if (i == buf.size())
      {
         if (isValid(buf))
            out.push_back(buf);
      }
      else
      {
         for (char ch : chars)
         {
            buf[i] = ch;
            generate(buf, out, i + 1);
         }
      }
   }
};

TEST_CASE("binary name 3", "[name]")
{
   Encoding<3>                   e{"-01", 0};
   std::vector<std::string_view> expected = {
       "",  "0",   "0-0", "0-1", "00",  "000", "001", "01",  "010", "011",
       "1", "1-0", "1-1", "10",  "100", "101", "11",  "110", "111",
   };
   CHECK(e.max() == expected.size() - 1);
   for (std::size_t i = 0; i < expected.size(); ++i)
   {
      CHECK(e.isValid(expected[i]));
      CHECK(e.encode(expected[i]) == i);
      CHECK(e.decode(i) == expected[i]);
   }
}

TEST_CASE("binary name 4", "[name]")
{
   Encoding<4>                   e{"-01", 0};
   std::vector<std::string_view> expected = {
       "",     "0",    "0-0",  "0-00", "0-01", "0-1",  "0-10", "0-11", "00",   "00-0", "00-1",
       "000",  "0000", "0001", "001",  "0010", "0011", "01",   "01-0", "01-1", "010",  "0100",
       "0101", "011",  "0110", "0111", "1",    "1-0",  "1-00", "1-01", "1-1",  "1-10", "1-11",
       "10",   "10-0", "10-1", "100",  "1000", "1001", "101",  "1010", "1011", "11",   "11-0",
       "11-1", "110",  "1100", "1101", "111",  "1110", "1111",
   };
   CHECK(e.max() == expected.size() - 1);
   for (std::size_t i = 0; i < expected.size(); ++i)
   {
      CHECK(e.isValid(expected[i]));
      CHECK(e.encode(expected[i]) == i);
      CHECK(e.decode(i) == expected[i]);
   }
}

TEST_CASE("mid separator", "[name]")
{
   Encoding<3>                   e{"0-1", 1};
   std::vector<std::string_view> expected = {
       "",  "0",  "00",  "000", "001", "0-0", "0-1", "01",  "010", "011",
       "1", "10", "100", "101", "1-0", "1-1", "11",  "110", "111",
   };
   CHECK(e.max() == expected.size() - 1);
   for (std::size_t i = 0; i < expected.size(); ++i)
   {
      CHECK(e.isValid(expected[i]));
      CHECK(e.encode(expected[i]) == i);
      CHECK(e.decode(i) == expected[i]);
   }
}

TEST_CASE("large name test", "[name]")
{
   constexpr std::size_t    N = 5;
   Encoding<N>              e{"-abcdef", 0};
   std::vector<std::string> expected;
   std::string              buf;
   for (std::size_t i = 0; i <= N; ++i)
   {
      buf.resize(i);
      e.generate(buf, expected);
   }
   std::ranges::sort(expected);
   CHECK(e.max() == expected.size() - 1);
   for (std::size_t i = 0; i < expected.size(); ++i)
   {
      CHECK(e.encode(expected[i]) == i);
      CHECK(e.decode(i) == expected[i]);
   }
}
