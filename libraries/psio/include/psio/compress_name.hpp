#pragma once
/*
The MIT License (MIT)

Copyright (c) 2014 Mark Thomas Nelson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

 This code was derived from code written to illustrate the article:
 Data Compression With Arithmetic Coding
 by Mark Nelson
 published at:
https://marknelson.us/posts/2014/10/19/data-compression-with-arithmetic-coding.html

 It has been modified by Daniel Larimer for the specific purpose of compressing
 short names and the encoder has been updated to use precomputed tables that
change based on the prior element.

*/
#pragma once
#include <cstdint>
#include <limits>
#include <string>

namespace psio
{
   namespace detail
   {
      struct func_model
      {
         typedef uint32_t           code_value;
         static constexpr const int code_value_bits =
             (std::numeric_limits<code_value>::digits + 3) / 2;
         static constexpr const int FREQUENCY_BITS =
             std::numeric_limits<code_value>::digits - code_value_bits;

         static constexpr const int  PRECISION = std::numeric_limits<code_value>::digits;
         static constexpr code_value MAX_CODE  = (code_value(1) << code_value_bits) - 1;
         //  static constexpr code_value MAX_FREQ      = (code_value(1) <<
         //  FREQUENCY_BITS) - 1;
         static constexpr code_value ONE_FOURTH = code_value(1) << (code_value_bits - 2);
         ;
         static constexpr code_value ONE_HALF      = 2 * ONE_FOURTH;
         static constexpr code_value THREE_FOURTHS = 3 * ONE_FOURTH;
         static constexpr int        model_width   = 27;

         struct prob
         {
            code_value low;
            code_value high;
            code_value count;
         };

         constexpr func_model() {}

         constexpr inline prob getProbability(int c)
         {
            auto cumulative_frequency = model_cf[m_last_byte];
            prob p                    = {cumulative_frequency[c], cumulative_frequency[c + 1],
                                         cumulative_frequency[model_width]};
            update(c);
            return p;
         }

         constexpr inline prob getChar(code_value scaled_value, int& c)
         {
            auto cumulative_frequency = model_cf[m_last_byte];

            for (int i = 0; i < model_width; i++)
               if (scaled_value < cumulative_frequency[i + 1])
               {
                  c      = i;
                  prob p = {cumulative_frequency[i], cumulative_frequency[i + 1],
                            cumulative_frequency[model_width]};
                  if (p.count == 0)
                  {
                     c = char_to_symbol[0];
                     update(c);
                     return prob{0, 1, 1};
                  }
                  update(c);
                  return p;
               }
            c = char_to_symbol[0];
            return prob{0, 1, 1};
         }
         constexpr code_value getCount() { return model_cf[m_last_byte][model_width]; }

         static constexpr uint32_t symbol_count      = 27;
         static constexpr char    symbol_to_char[27] = {0,   'e', 'a', 'i', 'o', 't', 'n', 'r', 's',
                                                        'l', 'c', 'u', 'h', 'd', 'p', 'm', 'y', 'g',
                                                        'b', 'f', 'w', 'v', 'k', 'z', 'x', 'q', 'j'};
         static constexpr uint8_t char_to_symbol[256] = {
             0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 0,  0,  0,  0,
             0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 0,  0,  0,  0,
             0,  0,  0,  0,  1,  2,  3,  4,  5,  6,  7,  8,  9,  10, 0,  0,  0,  0, 0,  0,  0,  2,
             18, 10, 13, 1,  19, 17, 12, 3,  26, 22, 9,  15, 6,  4,  14, 25, 7,  8, 5,  11, 21, 20,
             24, 16, 23, 0,  0,  0,  0,  25, 0,  2,  18, 10, 13, 1,  19, 17, 12, 3, 26, 22, 9,  15,
             6,  4,  14, 25, 7,  8,  5,  11, 21, 20, 24, 16, 23, 0,  0,  0,  0,  0, 0,  0,  0,  0,
             0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 0,  0,  0,  0,
             0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 0,  0,  0,  0,
             0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 0,  0,  0,  0,
             0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 0,  0,  0,  0,
             0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 0,  0,  0,  0,
             0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0};
         static constexpr uint16_t model_cf[27][28] = {
             {0,     0,     1956,  4146,  6063,  7423,  9305,  10276, 11226, 13687,
              14907, 16131, 17056, 18369, 19922, 21644, 23210, 24604, 25065, 26398,
              28475, 30408, 31395, 31725, 32367, 32402, 32623, 32767},
             {0,     4880,  5243,  6669,  7714,  8472,  9634,  11619, 15233, 16738,
              18031, 18650, 18993, 20913, 22653, 25217, 25802, 26404, 26589, 28244,
              29312, 31398, 31845, 32080, 32183, 32478, 32695, 32767},
             {0,     1737,  2901,  3020,  3666,  3734,  8543,  12634, 15523, 17208,
              21367, 22949, 23407, 24602, 25562, 26470, 28001, 28323, 29045, 30727,
              31040, 31251, 32084, 32387, 32496, 32598, 32745, 32767},
             {0,     1420,  3454,  4922,  5132,  6751,  9959,  13993, 14547, 18653,
              20482, 23055, 23598, 23956, 25067, 25566, 27966, 27973, 28483, 29334,
              29844, 30620, 31685, 31882, 32375, 32425, 32757, 32767},
             {0,     4209,  5209,  5503,  5994,  6779,  9809,  13734, 16394, 17728,
              20734, 21636, 23733, 24071, 24785, 26194, 28482, 28566, 29403, 30186,
              30894, 31383, 32100, 32294, 32382, 32531, 32744, 32767},
             {0,     6157,  9213,  10380, 13294, 15931, 16600, 16829, 17987, 18142,
              18574, 18667, 19055, 21787, 22406, 24449, 24772, 25604, 25663, 29173,
              30781, 31791, 31995, 32219, 32350, 32610, 32748, 32767},
             {0,     4891,  8913,  10772, 13035, 15218, 19118, 19893, 20080, 21202,
              22114, 23568, 23895, 24392, 26546, 26760, 27744, 28021, 30534, 31037,
              31376, 31650, 32250, 32490, 32548, 32565, 32709, 32767},
             {0,     4689,  9532,  12839, 16144, 19335, 21427, 21880, 22583, 23728,
              24811, 25404, 25957, 26777, 27443, 28035, 29213, 30179, 30481, 31447,
              31666, 31782, 32303, 32484, 32510, 32511, 32751, 32767},
             {0,     5750,  9495,  10402, 12127, 13082, 19468, 19684, 19710, 21681,
              23775, 24600, 25576, 26982, 27084, 27953, 30214, 30492, 30515, 30947,
              31019, 31446, 31709, 31847, 31884, 31884, 32761, 32767},
             {0,     1827,  5418,  7243,  11598, 13806, 14484, 14972, 15432, 15532,
              16785, 16863, 17441, 18465, 19298, 23066, 24626, 26449, 26523, 27067,
              29601, 31460, 31683, 32257, 32266, 32312, 32318, 32767},
             {0,     3085,  6902,  11386, 13498, 18692, 21202, 21246, 22818, 22950,
              23980, 24484, 25962, 30168, 30176, 30181, 30391, 31287, 31288, 31293,
              31294, 31297, 31592, 32703, 32712, 32712, 32767, 32767},
             {0,     1460,  2488,  3382,  4190,  4382,  7997,  13589, 16710, 21209,
              25118, 26178, 26204, 26432, 27181, 28387, 30216, 30257, 30864, 31867,
              32177, 32219, 32374, 32455, 32551, 32617, 32754, 32767},
             {0,     3497,  9469,  11581, 13649, 15750, 19606, 19858, 20362, 20409,
              23728, 23738, 24110, 26020, 26170, 26284, 28241, 29240, 29247, 29296,
              29442, 29819, 30442, 30559, 30604, 30604, 32763, 32767},
             {0,     7725,  13656, 15552, 18212, 19436, 22322, 22566, 23251, 23443,
              26247, 26267, 26704, 26809, 27460, 27622, 29567, 30839, 30969, 31225,
              31379, 31448, 32114, 32127, 32143, 32143, 32739, 32767},
             {0,     3654,  6677,  7904,  9941,  12843, 16232, 16550, 19915, 20300,
              22842, 22898, 23406, 25127, 25246, 25931, 27743, 28101, 28153, 28321,
              29252, 31975, 32243, 32396, 32480, 32494, 32721, 32767},
             {0,     2259,  4242,  6358,  8676,  10453, 10663, 11361, 12343, 12503,
              13022, 13049, 13568, 15061, 16673, 21204, 22114, 23775, 23801, 26743,
              28089, 29382, 31518, 31992, 32482, 32634, 32711, 32767},
             {0,     8569,  10926, 11269, 11458, 12219, 15419, 15811, 16168, 19632,
              21864, 22233, 22272, 23584, 23897, 24563, 27086, 27677, 27838, 30347,
              30897, 31720, 32305, 32316, 32374, 32410, 32766, 32767},
             {0,     5421,  10228, 13261, 16435, 18453, 18538, 19596, 22477, 22749,
              25180, 25189, 26615, 28325, 28370, 28391, 28704, 29610, 30232, 30341,
              30376, 30446, 32750, 32760, 32764, 32764, 32765, 32767},
             {0,     3536,  8233,  9248,  10667, 11916, 16198, 16366, 17262, 17620,
              22341, 22384, 23103, 23432, 24178, 24653, 27955, 28446, 28462, 29156,
              29914, 30860, 31440, 31618, 31718, 31718, 32711, 32767},
             {0,     6957,  8777,  9282,  11114, 12083, 14679, 14746, 15172, 16789,
              19423, 19431, 20076, 20456, 21353, 21603, 22831, 23934, 24047, 24077,
              26986, 30996, 32258, 32271, 32421, 32421, 32764, 32767},
             {0,     4391,  7270,  8148,  9018,  9499,  14426, 14654, 14752, 18571,
              23671, 23681, 23696, 24591, 24714, 24801, 27775, 27825, 27830, 30016,
              30215, 30862, 31659, 31682, 31823, 31824, 32740, 32767},
             {0,     508,   5145,  6952,  9251,  10376, 10985, 11140, 11725, 11743,
              12502, 12513, 12662, 15602, 17187, 22455, 22627, 23556, 23562, 26519,
              30666, 32564, 32574, 32641, 32646, 32708, 32730, 32767},
             {0,     2561,  9484,  10526, 12712, 13144, 24077, 24752, 24913, 25311,
              29557, 29584, 29814, 30171, 30199, 30250, 31654, 31986, 32003, 32134,
              32255, 32412, 32625, 32686, 32687, 32687, 32751, 32767},
             {0,     1902,  10556, 12815, 13501, 14918, 18520, 18600, 18633, 21631,
              26209, 26218, 26391, 26794, 26889, 27833, 30807, 31246, 31254, 31774,
              32060, 32183, 32247, 32252, 32655, 32655, 32756, 32767},
             {0,     3478,  6497,  8308,  12600, 13818, 17038, 17122, 17152, 17528,
              20748, 21906, 22255, 22599, 22677, 24481, 25735, 28777, 28815, 28891,
              29073, 31075, 31424, 31433, 31485, 31485, 32764, 32767},
             {0,     17596, 18281, 18455, 19256, 19875, 20521, 20599, 20949, 21038,
              21413, 21416, 23479, 24932, 25804, 26610, 28270, 29555, 29557, 30312,
              31584, 32451, 32516, 32525, 32623, 32701, 32703, 32767},
             {0,     392,   8308,  10995, 11504, 13348, 22180, 22194, 22231, 22248,
              23981, 23981, 26646, 26978, 27000, 27014, 30409, 30435, 30435, 30457,
              30474, 30503, 30697, 30704, 30818, 30818, 31861, 32767}};

        private:
         constexpr inline void update(int c) { m_last_byte = c; }
         uint8_t               m_last_byte = char_to_symbol[0];
      };

      inline constexpr std::uint64_t seahash(std::string_view input)
      {
         auto g = [](std::uint64_t x)
         {
            std::uint64_t p = 0x6eed0e9da4d94a4fu;
            x *= p;
            x = x ^ ((x >> 32) >> (x >> 60));
            x *= p;
            return x;
         };
         std::uint64_t state[4] = {0x16f11fe89b0d677cu, 0xb480a793d8e6c86cu, 0x6fe2e5aaf078ebc9u,
                                   0x14f994a4c5259381u};
         for (std::size_t i = 0; i < input.size(); i += 8)
         {
            std::uint64_t n     = 0;
            auto          bytes = std::min(input.size() - i, std::size_t{8});
            for (std::size_t j = 0; j < bytes; ++j)
            {
               n += static_cast<std::uint64_t>(static_cast<std::uint8_t>(input[i + j])) << (j * 8);
            }
            auto& item = state[(i / 8) % 4];
            item       = g(item ^ n);
         }
         return g(state[0] ^ state[1] ^ state[2] ^ state[3] ^ input.size());
      }

      // TODO: what happened to the _-elimination rule?
      inline constexpr uint64_t method_to_number(std::string_view m_input)
      {
         if (m_input.size() == 0)
            return 0;

         if (m_input[0] == '#')
         {
            if (m_input.size() != 17)
               return -1;

            uint64_t output = 0;
            for (uint32_t i = 1; i < 17; ++i)
            {
               uint64_t sym = uint8_t((func_model::char_to_symbol[uint8_t(m_input[i])]) - 1);
               sym <<= 4 * (i - 1);
               output |= sym;
            }
            return output;
         }

         func_model                       m_model;
         std::string_view::const_iterator m_in_itr(m_input.begin());
         for (uint8_t i : m_input)
            if (not func_model::char_to_symbol[i])
               return 0;

         typedef typename func_model::code_value code_value;
         typedef typename func_model::prob       prob;
         typedef func_model                      MODEL;

         uint8_t       m_bit      = 0;
         uint8_t       m_NextByte = 0;
         unsigned char m_Mask     = 0x80;
         uint64_t      m_output   = 0;
         int           m_bitc     = 0;

         auto put_bit = [&](bool b)
         {
            if (b and m_bitc == 63)
            {
               m_output = 0;
               m_bit    = 64;
            }
            else
            {
               ++m_bitc;
               if (b)
                  m_NextByte |= m_Mask;
               m_Mask >>= 1;
               if (!m_Mask and m_bit < 64)
               {
                  m_output |= (uint64_t(m_NextByte) << m_bit);
                  m_bit += 8;

                  m_Mask     = 0x80;
                  m_NextByte = 0;
               }
            }
         };

         auto getByte = [&]()
         {
            if (m_in_itr == m_input.end())
               return 0;
            int c = m_model.char_to_symbol[uint8_t(*m_in_itr)];
            ++m_in_itr;
            return c;
         };

         int        pending_bits = 0;
         code_value low          = 0;
         code_value high         = func_model::MAX_CODE;

         auto put_bit_plus_pending = [&](bool bit)
         {
            put_bit(bit);
            while (pending_bits)
            {
               put_bit(!bit);
               --pending_bits;
            }
         };

         int c = 1;
         for (; c != '\0' and m_bit < 64;)
         {
            c = getByte();

            prob       p     = m_model.getProbability(c);
            code_value range = high - low + 1;

            if (p.count == 0)
               return 0;  /// logic error shouldn't happen

            high = low + (range * p.high / p.count) - 1;
            low  = low + (range * p.low / p.count);

            // On each pass there are six possible configurations of high/low,
            // each of which has its own set of actions. When high or low
            // is converging, we output their MSB and upshift high and low.
            // When they are in a near-convergent state, we upshift over the
            // next-to-MSB, increment the pending count, leave the MSB intact,
            // and don't output anything. If we are not converging, we do
            // no shifting and no output.
            // high: 0xxx, low anything : converging (output 0)
            // low: 1xxx, high anything : converging (output 1)
            // high: 10xxx, low: 01xxx : near converging
            // high: 11xxx, low: 01xxx : not converging
            // high: 11xxx, low: 00xxx : not converging
            // high: 10xxx, low: 00xxx : not converging
            for (; m_bit < 64;)
            {
               if (high < MODEL::ONE_HALF)
                  put_bit_plus_pending(0);
               else if (low >= MODEL::ONE_HALF)
                  put_bit_plus_pending(1);
               else if (low >= MODEL::ONE_FOURTH && high < MODEL::THREE_FOURTHS)
               {
                  pending_bits++;
                  low -= MODEL::ONE_FOURTH;
                  high -= MODEL::ONE_FOURTH;
               }
               else
                  break;
               high <<= 1;
               high++;
               low <<= 1;
               high &= MODEL::MAX_CODE;
               low &= MODEL::MAX_CODE;
            }
         }

         pending_bits++;

         if (low < MODEL::ONE_FOURTH)
            put_bit_plus_pending(0);
         else
            put_bit_plus_pending(1);

         if (m_Mask != 0x80 and m_bit < 64)
            m_output |= (uint64_t(m_NextByte) << m_bit);

         if (m_in_itr != m_input.end() || c != '\0')
            m_output = 0;

         // TODO: replace with hash function which has been ported to other languages
         // TODO: why is this different from (and somewhat redundant with) the hashing
         //       in hash_name()?
         if (not m_output)
         {
            m_output = seahash(m_input);
            m_output |= (uint64_t(0x01) << (64 - 8));
         }

         return m_output;
      }  // name_to_number

      inline constexpr bool is_hash_name(uint64_t h)
      {
         return (h & (uint64_t(0x01) << (64 - 8))) > 0;
      }

      inline std::string number_to_method(uint64_t input)
      {
         if (not input)
            return std::string();
         //if (input & (uint64_t(0x01) << (64 - 8)))
         if (is_hash_name(input))
         {
            std::string str = "#";
            /// then it is a hash
            uint64_t r = input;
            for (uint32_t i = 0; i < 16; ++i)
            {
               str += func_model::symbol_to_char[uint8_t((r & 0x0f)) + 1];
               r >>= 4;
            }
            return str;
         }

         typedef typename func_model::code_value code_value;
         typedef typename func_model::prob       prob;

         func_model m_model;
         int        current_byte = 0;
         uint8_t    last_mask    = 1;
         int not_eof = 64 + 16;  // allow extra bits to be brought in as helps improve accuracy

         auto get_bit = [&]()
         {
            if (last_mask == 1)
            {
               current_byte = input & 0xff;
               input >>= 8;
               last_mask = 0x80;
            }
            else
               last_mask >>= 1;
            --not_eof;
            return (current_byte & last_mask) != 0;
         };

         std::string out;
         out.reserve(15);

         code_value high  = func_model::MAX_CODE;
         code_value low   = 0;
         code_value value = 0;
         for (int i = 0; (i < func_model::code_value_bits) and not_eof; i++)
         {
            value <<= 1;
            value += get_bit() ? 1 : 0;
         }
         while (not_eof)
         {
            code_value range = high - low + 1;

            if (range == 0)
               return "RUNTIME LOGIC ERROR";

            code_value scaled_value = ((value - low + 1) * m_model.getCount() - 1) / range;
            int        c;
            prob       p = m_model.getChar(scaled_value, c);
            if (c == '\0')
               break;

            out += m_model.symbol_to_char[uint8_t(c)];

            if (p.count == 0)
               return "RUNTIME LOGIC ERROR";

            high = low + (range * p.high) / p.count - 1;
            low  = low + (range * p.low) / p.count;

            while (not_eof)
            {
               if (high < func_model::ONE_HALF)
               {
                  // do nothing, bit is a zero
               }
               else if (low >= func_model::ONE_HALF)
               {
                  value -= func_model::ONE_HALF;  // subtract one half from all three
                                                  // code values
                  low -= func_model::ONE_HALF;
                  high -= func_model::ONE_HALF;
               }
               else if (low >= func_model::ONE_FOURTH && high < func_model::THREE_FOURTHS)
               {
                  value -= func_model::ONE_FOURTH;
                  low -= func_model::ONE_FOURTH;
                  high -= func_model::ONE_FOURTH;
               }
               else
                  break;
               low <<= 1;
               high <<= 1;
               high++;
               value <<= 1;
               value += get_bit() ? 1 : 0;
            }
         }
         return out;
      }

   }  // namespace detail
}  // namespace psio
