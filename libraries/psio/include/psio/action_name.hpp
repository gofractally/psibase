#pragma once

#include <array>
#include <bit>
#include <cstdint>
#include <optional>
#include <psio/check.hpp>
#include <psio/detail/action_name_data.hpp>
#include <string>
#include <string_view>

namespace psio::action_names
{
   inline constexpr std::string_view model_sha256 = detail::action_name_data::model_sha256;
   inline constexpr std::string_view alphabet     = "abcdefghijklmnopqrstuvwxyz0123456789_";
   inline constexpr std::size_t      max_length   = 256;
   inline constexpr uint64_t         payload_mask = (uint64_t{1} << 62) - 1;
   inline constexpr uint64_t         hash_tag     = uint64_t{3} << 62;

   namespace impl
   {
      namespace data                    = psio::detail::action_name_data;
      inline constexpr uint64_t maximum = 0xffffffff;
      inline constexpr uint64_t half    = uint64_t{1} << 31;
      inline constexpr uint64_t quarter = uint64_t{1} << 30;
      struct Name
      {
         std::array<char, max_length> text{};
         uint16_t                     size = 0;
      };
      struct Tokens
      {
         std::array<uint16_t, max_length + 1> ids{};
         uint16_t                             size = 0;
      };
      constexpr int symbol(char c)
      {
         if (c >= 'a' && c <= 'z')
            return c - 'a';
         if (c >= '0' && c <= '9')
            return c - '0' + 26;
         return c == '_' ? 36 : -1;
      }
      constexpr std::optional<Name> normalize(std::string_view input)
      {
         if (input.empty() || input.size() > max_length)
            return {};
         Name result;
         result.size = input.size();
         for (std::size_t i = 0; i < input.size(); ++i)
         {
            char c = input[i];
            if (c >= 'A' && c <= 'Z')
               c = c - 'A' + 'a';
            if (symbol(c) < 0 || (i == 0 && c >= '0' && c <= '9'))
               return {};
            result.text[i] = c;
         }
         return result;
      }
      constexpr uint32_t next_node(uint32_t node, char c)
      {
         const auto& entry = data::word_nodes[node];
         uint32_t    first = entry.first_edge, last = first + entry.edge_count;
         while (first < last)
         {
            uint32_t middle = first + (last - first) / 2;
            if (data::word_edges[middle].character < c)
               first = middle + 1;
            else
               last = middle;
         }
         if (first < entry.first_edge + entry.edge_count && data::word_edges[first].character == c)
            return data::word_edges[first].next;
         return uint32_t(-1);
      }
      /// DP ties are (integer cost, token count, whole token-ID tuple).
      constexpr Tokens word_tokens(const Name& name)
      {
         std::array<uint64_t, max_length + 1> costs{};
         std::array<uint16_t, max_length + 1> counts{}, previous{}, token{};
         costs.fill(uint64_t(-1));
         costs[0]          = 0;
         auto lexical_less = [&](uint16_t begin, uint16_t candidate, uint16_t end)
         {
            std::array<uint16_t, max_length> lhs{}, rhs{};
            auto                             count = counts[begin];
            lhs[count]                             = candidate;
            auto position                          = begin;
            for (auto i = count; i > 0; --i)
            {
               lhs[i - 1] = token[position];
               position   = previous[position];
            }
            position = end;
            for (auto i = counts[end]; i > 0; --i)
            {
               rhs[i - 1] = token[position];
               position   = previous[position];
            }
            for (uint16_t i = 0; i <= count; ++i)
               if (lhs[i] != rhs[i])
                  return lhs[i] < rhs[i];
            return false;
         };
         for (uint16_t begin = 0; begin < name.size; ++begin)
         {
            uint32_t node = 0;
            for (uint16_t end = begin; end < name.size; ++end)
            {
               node = next_node(node, name.text[end]);
               if (node == uint32_t(-1))
                  break;
               uint16_t id = data::word_nodes[node].token;
               if (!id)
                  continue;
               uint64_t proposed = costs[begin] + data::word_costs[id];
               uint16_t count = counts[begin] + 1, destination = end + 1;
               if (proposed < costs[destination] ||
                   (proposed == costs[destination] &&
                    (count < counts[destination] ||
                     (count == counts[destination] && lexical_less(begin, id, destination)))))
               {
                  costs[destination]    = proposed;
                  counts[destination]   = count;
                  previous[destination] = begin;
                  token[destination]    = id;
               }
            }
         }
         Tokens result;
         result.size       = counts[name.size];
         uint16_t position = name.size;
         for (auto i = result.size; i > 0; --i)
         {
            result.ids[i - 1] = token[position];
            position          = previous[position];
         }
         return result;
      }
      struct Arithmetic
      {
         uint64_t value = 0;
         unsigned bits  = 0;
      };
      constexpr const uint16_t* character_row(int previous, int last)
      {
         auto row = previous < 0 ? (last < 0 ? 0 : 1 + last) : 38 + previous * 37 + last;
         return data::character_cdf[row];
      }
      constexpr Arithmetic arithmetic_encode(const Name& name, bool words)
      {
         Tokens tokens;
         if (words)
            tokens = word_tokens(name);
         else
         {
            tokens.size = name.size;
            for (uint16_t i = 0; i < name.size; ++i)
               tokens.ids[i] = symbol(name.text[i]) + 1;
         }
         Arithmetic result;
         uint64_t   low = 0, high = maximum;
         unsigned   pending  = 0;
         int        previous = -1, last = -1;
         auto       emit = [&](bool bit)
         {
            if (result.bits < 63 && bit)
               result.value |= uint64_t{1} << (62 - result.bits);
            ++result.bits;
            while (pending)
            {
               if (result.bits < 63 && !bit)
                  result.value |= uint64_t{1} << (62 - result.bits);
               ++result.bits;
               --pending;
            }
         };
         for (uint16_t i = 0; i <= tokens.size; ++i)
         {
            auto     id    = i == tokens.size ? 0 : tokens.ids[i];
            auto     cdf   = words ? data::word_cdf : character_row(previous, last);
            uint64_t width = high - low + 1;
            high           = low + width * cdf[id + 1] / 32768 - 1;
            low += width * cdf[id] / 32768;
            while (true)
            {
               if (high < half)
                  emit(false);
               else if (low >= half)
               {
                  emit(true);
                  low -= half;
                  high -= half;
               }
               else if (low >= quarter && high < 3 * quarter)
               {
                  ++pending;
                  low -= quarter;
                  high -= quarter;
               }
               else
                  break;
               low <<= 1;
               high = (high << 1) | 1;
            }
            previous = last;
            last     = id - 1;
         }
         ++pending;
         emit(low >= quarter);
         return result;
      }
      constexpr uint32_t rotate(uint32_t x, unsigned n)
      {
         return (x >> n) | (x << (32 - n));
      }
      /// Constexpr SHA-256 keeps generated fallback dispatch IDs compile-time.
      constexpr uint64_t hash(const Name& name)
      {
         constexpr std::string_view domain{"psibase.action_name.v1\0", 23};
         constexpr uint32_t         k[] = {
             0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
             0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
             0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
             0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
             0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
             0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
             0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
             0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
             0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
             0xc67178f2};
         std::array<uint8_t, 320> bytes{};
         std::size_t              length = domain.size() + name.size;
         for (std::size_t i = 0; i < domain.size(); ++i)
            bytes[i] = domain[i];
         for (std::size_t i = 0; i < name.size; ++i)
            bytes[domain.size() + i] = name.text[i];
         bytes[length] = 0x80;
         auto blocks   = (length + 9 + 63) / 64;
         for (unsigned i = 0; i < 8; ++i)
            bytes[blocks * 64 - 1 - i] = (uint64_t(length) * 8) >> (i * 8);
         std::array<uint32_t, 8> state{0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                                       0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
         for (std::size_t block = 0; block < blocks; ++block)
         {
            std::array<uint32_t, 64> w{};
            for (unsigned i = 0; i < 16; ++i)
               for (unsigned j = 0; j < 4; ++j)
                  w[i] = (w[i] << 8) | bytes[block * 64 + i * 4 + j];
            for (unsigned i = 16; i < 64; ++i)
            {
               uint32_t a = w[i - 15], b = w[i - 2];
               w[i] = w[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ (a >> 3)) + w[i - 7] +
                      (rotate(b, 17) ^ rotate(b, 19) ^ (b >> 10));
            }
            auto v = state;
            for (unsigned i = 0; i < 64; ++i)
            {
               uint32_t t1 = v[7] + (rotate(v[4], 6) ^ rotate(v[4], 11) ^ rotate(v[4], 25)) +
                             ((v[4] & v[5]) ^ (~v[4] & v[6])) + k[i] + w[i];
               uint32_t t2 = (rotate(v[0], 2) ^ rotate(v[0], 13) ^ rotate(v[0], 22)) +
                             ((v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]));
               v           = {t1 + t2, v[0], v[1], v[2], v[3] + t1, v[4], v[5], v[6]};
            }
            for (unsigned i = 0; i < 8; ++i)
               state[i] += v[i];
         }
         uint64_t result = 0;
         for (unsigned i = 0; i < 8; ++i)
            result |= uint64_t((state[i / 4] >> (24 - 8 * (i % 4))) & 255) << (8 * i);
         return hash_tag | (result & payload_mask);
      }
   }  // namespace impl

   inline constexpr bool is_hash(uint64_t value)
   {
      return value >> 62 == 3;
   }
   /// Invalid input is explicit; it never silently becomes an unset numeric ID.
   inline constexpr std::optional<uint64_t> try_encode(std::string_view input)
   {
      if (!input.empty() && input[0] == '#')
      {
         if (input.size() != 17)
            return {};
         uint64_t value = 0;
         for (auto c : input.substr(1))
         {
            unsigned digit;
            if (c >= '0' && c <= '9')
               digit = c - '0';
            else if (c >= 'a' && c <= 'f')
               digit = c - 'a' + 10;
            else
               return {};
            value = (value << 4) | digit;
         }
         return is_hash(value) ? std::optional{value} : std::nullopt;
      }
      auto name = impl::normalize(input);
      if (!name)
         return {};
      std::optional<uint64_t> best;
      unsigned                best_bits = 63;
      auto                    add       = [&](unsigned bits, unsigned mode, uint64_t payload)
      {
         uint64_t value = (uint64_t(mode) << 62) | payload;
         if (!best || bits < best_bits || (bits == best_bits && value < *best))
         {
            best      = value;
            best_bits = bits;
         }
      };
      for (unsigned mode = 0; mode < 2; ++mode)
      {
         auto result = impl::arithmetic_encode(*name, mode == 1);
         if (result.bits <= 62 && result.value)
            add(result.bits, mode, result.value >> 1);
      }
      uint64_t literal = 0;
      bool     fits    = true;
      for (unsigned i = 0; i < name->size; ++i)
      {
         auto digit = impl::symbol(name->text[i]) + 1;
         if (literal > (payload_mask - digit) / 37)
         {
            fits = false;
            break;
         }
         literal = literal * 37 + digit;
      }
      if (fits && literal)
         add(std::bit_width(literal), 2, literal);
      return best ? best : std::optional{impl::hash(*name)};
   }
   inline constexpr uint64_t encode(std::string_view name)
   {
      auto result = try_encode(name);
      if (!result)
         psio::abort_error(
             "Invalid action name: expected ASCII identifier or canonical hash literal");
      return *result;
   }

   inline std::optional<std::string> try_decode(uint64_t value)
   {
      auto        mode    = value >> 62;
      uint64_t    payload = value & payload_mask;
      std::string result;
      if (mode == 3)
      {
         constexpr char hex[] = "0123456789abcdef";
         result               = "#";
         for (int i = 15; i >= 0; --i)
            result += hex[(value >> (i * 4)) & 15];
         return result;
      }
      if (mode == 2)
      {
         while (payload)
         {
            auto index = (payload - 1) % 37;
            payload    = (payload - 1) / 37;
            result += alphabet[index];
         }
         for (std::size_t i = 0; i < result.size() / 2; ++i)
            std::swap(result[i], result[result.size() - i - 1]);
      }
      else
      {
         uint64_t bits = payload << 1, low = 0, high = impl::maximum, code = 0;
         unsigned position = 0;
         auto     take     = [&]()
         {
            bool bit = position < 63 && ((bits >> (62 - position)) & 1);
            ++position;
            return bit;
         };
         for (unsigned i = 0; i < 32; ++i)
            code = (code << 1) | take();
         int  previous = -1, last = -1;
         bool eos = false;
         for (unsigned count = 0; count <= max_length; ++count)
         {
            if (code < low || code > high)
               return {};
            auto     cdf   = mode == 1 ? impl::data::word_cdf : impl::character_row(previous, last);
            auto     size  = mode == 1 ? std::size(impl::data::words) : 38;
            uint64_t width = high - low + 1;
            uint64_t scaled   = ((code - low + 1) * 32768 - 1) / width;
            std::size_t first = 0, end = size;
            while (first < end)
            {
               auto middle = first + (end - first) / 2;
               if (cdf[middle + 1] <= scaled)
                  first = middle + 1;
               else
                  end = middle;
            }
            if (first >= size)
               return {};
            if (!first)
            {
               eos = true;
               break;
            }
            if (mode == 1)
               result += impl::data::words[first];
            else
               result += alphabet[first - 1];
            if (result.size() > max_length)
               return {};
            high = low + width * cdf[first + 1] / 32768 - 1;
            low += width * cdf[first] / 32768;
            while (true)
            {
               if (high < impl::half)
               {
               }
               else if (low >= impl::half)
               {
                  code -= impl::half;
                  low -= impl::half;
                  high -= impl::half;
               }
               else if (low >= impl::quarter && high < 3 * impl::quarter)
               {
                  code -= impl::quarter;
                  low -= impl::quarter;
                  high -= impl::quarter;
               }
               else
                  break;
               low <<= 1;
               high = (high << 1) | 1;
               code = (code << 1) | take();
            }
            previous = last;
            last     = first - 1;
         }
         if (!eos)
            return {};
      }
      auto canonical = impl::normalize(result);
      if (!canonical)
         return {};
      for (unsigned i = 0; i < canonical->size; ++i)
         if (canonical->text[i] != result[i])
            return {};
      auto encoded = try_encode(result);
      return encoded && *encoded == value ? std::optional{result} : std::nullopt;
   }
   inline std::string decode(uint64_t value)
   {
      auto result = try_decode(value);
      if (!result)
         psio::abort_error("Invalid or noncanonical action name ID");
      return std::move(*result);
   }
}  // namespace psio::action_names
