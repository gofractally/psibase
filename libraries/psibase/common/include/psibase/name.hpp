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
 published at: http://marknelson.us/2014/10/19/data-compression-with-arithmetic-coding

 It has been modified by Daniel Larimer for the specific purpose of compressing
 short names and the encoder has been updated to use precomputed tables that change
 based on the prior element and it is no longer general purpose.

*/
#pragma once
#include <psio/reflect.hpp>

namespace psibase
{

   struct name_model
   {
      typedef uint32_t           code_value;
      static constexpr const int code_value_bits =
          (std::numeric_limits<code_value>::digits + 3) / 2;
      static constexpr const int FREQUENCY_BITS =
          std::numeric_limits<code_value>::digits - code_value_bits;

      static constexpr const int  PRECISION = std::numeric_limits<code_value>::digits;
      static constexpr code_value MAX_CODE  = (code_value(1) << code_value_bits) - 1;
      //  static constexpr code_value MAX_FREQ      = (code_value(1) << FREQUENCY_BITS) - 1;
      static constexpr code_value ONE_FOURTH = code_value(1) << (code_value_bits - 2);
      ;
      static constexpr code_value ONE_HALF      = 2 * ONE_FOURTH;
      static constexpr code_value THREE_FOURTHS = 3 * ONE_FOURTH;
      static constexpr int        model_width   = 38;

      struct prob
      {
         code_value low;
         code_value high;
         code_value count;
      };

      constexpr name_model() {}

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
                  c = char_to_symbol['\0'];
                  update(c);
                  return prob{0, 1, 1};
               }
               update(c);
               return p;
            }
         c = char_to_symbol['\0'];
         return prob{0, 1, 1};
      }
      constexpr code_value getCount() { return model_cf[m_last_byte][model_width]; }

      static constexpr uint32_t symbol_count   = 38;
      static constexpr char symbol_to_char[38] = {0,   'e', 'a', 'o', 'r', 'i', 'n', 't', 's', 'l',
                                                  'd', 'h', 'm', 'c', 'u', 'y', 'g', 'b', 'p', 'k',
                                                  'w', '-', 'f', '1', '2', 'v', '0', 'j', '3', 'z',
                                                  '9', 'x', '4', '7', '8', '5', '6', 'q'};
      static constexpr uint8_t char_to_symbol[256] = {
          0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 0,  0, 0, 0,  0,  0, 0, 0, 0,  0,  0,
          0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 0,  0, 0, 0,  0,  0, 0, 0, 21, 0,  0,
          26, 23, 24, 28, 32, 35, 36, 33, 34, 30, 0,  0,  0, 0,  0, 0, 0,  0,  0, 0, 0, 0,  0,  0,
          0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 0,  0, 0, 0,  0,  0, 0, 0, 0,  0,  0,
          0,  2,  17, 13, 10, 1,  22, 16, 11, 5,  27, 19, 9, 12, 6, 3, 18, 37, 4, 8, 7, 14, 25, 20,
          31, 15, 29, 0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 0,  0, 0, 0,  0,  0, 0, 0, 0,  0,  0,
          0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 0,  0, 0, 0,  0,  0, 0, 0, 0,  0,  0,
          0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 0,  0, 0, 0,  0,  0, 0, 0, 0,  0,  0,
          0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 0,  0, 0, 0,  0,  0, 0, 0, 0,  0,  0,
          0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 0,  0, 0, 0,  0,  0, 0, 0, 0,  0,  0,
          0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 0,  0, 0};
      static constexpr uint16_t model_cf[38][39] = {
          {0,     1,     862,   2908,  3513,  4989,  6103,  7218,  9965,  13074,
           14397, 16325, 17420, 19736, 21713, 22054, 22398, 23522, 25457, 26970,
           28069, 28930, 28930, 30084, 30084, 30084, 30545, 30545, 31987, 31987,
           32323, 32350, 32620, 32620, 32620, 32620, 32620, 32620, 32767},
          {0,     2970,  4543,  6487,  6925,  12439, 12956, 15504, 16967, 19523,
           21497, 23208, 23513, 24517, 25327, 25530, 26230, 26817, 27435, 28069,
           28429, 28969, 29806, 30287, 30557, 30715, 31284, 31358, 31508, 31585,
           31835, 31919, 32396, 32477, 32538, 32607, 32656, 32711, 32767},
          {0,     1374,  1626,  1999,  2143,  5560,  6497,  11473, 13950, 15929,
           18544, 19981, 20449, 22327, 23821, 24325, 25836, 26671, 27478, 28292,
           29068, 30170, 30499, 30848, 30992, 31070, 31636, 31675, 31851, 31888,
           32300, 32344, 32560, 32594, 32627, 32662, 32689, 32715, 32767},
          {0,     1564,  1978,  2446,  4579,  7810,  8289,  12895, 14707, 16261,
           18122, 19108, 19564, 21212, 22096, 23951, 24391, 25080, 26020, 27000,
           27679, 29772, 30101, 30949, 31111, 31200, 31798, 31847, 31986, 32032,
           32197, 32249, 32561, 32601, 32639, 32680, 32710, 32741, 32767},
          {0,     2907,  7236,  10894, 14971, 15898, 18953, 19736, 21142, 22320,
           23011, 24214, 24427, 25092, 25644, 26675, 27607, 28157, 28642, 29089,
           29845, 30036, 30647, 30954, 31278, 31453, 31642, 31788, 31911, 32031,
           32150, 32252, 32330, 32434, 32506, 32595, 32656, 32731, 32767},
          {0,     1057,  2826,  4202,  5416,  6850,  7227,  13303, 16130, 19092,
           21221, 22456, 22606, 23952, 26558, 26769, 26850, 28177, 28572, 29178,
           29933, 30053, 30340, 30895, 30985, 31035, 31613, 31649, 31764, 31798,
           32248, 32280, 32578, 32603, 32625, 32652, 32671, 32690, 32767},
          {0,     3420,  6470,  8938,  11134, 11400, 13626, 14759, 17307, 18772,
           19106, 21674, 21926, 22277, 23313, 23821, 24535, 27595, 27993, 28230,
           29224, 29399, 30084, 30446, 30848, 31070, 31232, 31375, 31666, 31792,
           32024, 32151, 32263, 32371, 32463, 32569, 32642, 32722, 32767},
          {0,     2631,  6465,  9246,  12000, 13826, 16438, 16663, 18266, 19589,
           20155, 20388, 26137, 26538, 27122, 27990, 29067, 29281, 29609, 29826,
           29964, 30358, 31071, 31344, 31580, 31715, 31812, 31904, 32013, 32101,
           32328, 32395, 32468, 32549, 32597, 32653, 32698, 32747, 32767},
          {0,     4601,  7052,  9239,  10945, 11204, 12968, 13469, 18236, 20065,
           20745, 21180, 23716, 24545, 25548, 26644, 27068, 27332, 27668, 28711,
           29443, 29924, 30683, 31005, 31352, 31550, 31642, 31744, 31883, 31980,
           32044, 32149, 32211, 32321, 32395, 32480, 32536, 32602, 32767},
          {0,     1854,  7276,  11228, 14640, 14858, 18704, 18852, 19618, 20487,
           24125, 25101, 25257, 25715, 26035, 27365, 28845, 29073, 29425, 29868,
           30266, 30421, 30911, 31393, 31584, 31691, 31946, 32040, 32146, 32233,
           32400, 32460, 32517, 32579, 32621, 32674, 32708, 32745, 32767},
          {0,     3064,  7929,  11787, 15109, 16895, 20069, 20413, 20870, 22044,
           22641, 24010, 24378, 24930, 25323, 26536, 27562, 28098, 28579, 28890,
           29127, 29470, 30289, 30805, 31107, 31284, 31495, 31618, 31921, 32045,
           32185, 32278, 32373, 32476, 32543, 32619, 32674, 32736, 32767},
          {0,     1963,  9365,  14894, 18210, 20909, 24587, 25164, 26225, 26600,
           26914, 27189, 27529, 27941, 28123, 29379, 30071, 30259, 30532, 30691,
           30849, 31027, 31400, 31577, 31791, 31911, 31974, 32076, 32204, 32309,
           32354, 32417, 32473, 32552, 32599, 32663, 32703, 32742, 32767},
          {0,     1528,  6875,  14214, 17481, 18268, 21728, 22062, 22396, 23176,
           23398, 23672, 23822, 24981, 25645, 26757, 28009, 28230, 29351, 30529,
           30683, 30806, 31385, 31561, 31754, 31857, 31926, 32025, 32175, 32268,
           32367, 32425, 32488, 32565, 32606, 32675, 32710, 32745, 32767},
          {0,     1181,  3832,  7968,  12348, 14055, 15358, 15503, 16705, 17174,
           18245, 18459, 24081, 24331, 25091, 26139, 26567, 26744, 26944, 27140,
           31302, 31388, 31666, 31808, 31954, 32044, 32123, 32210, 32312, 32372,
           32452, 32498, 32554, 32606, 32640, 32678, 32706, 32733, 32767},
          {0,     1067,  2429,  3271,  3443,  7106,  8245,  12093, 14270, 18945,
           20816, 22038, 22323, 24071, 25799, 26074, 26848, 27851, 28920, 30174,
           30771, 30879, 31059, 31579, 31668, 31726, 31882, 31908, 32022, 32056,
           32356, 32384, 32600, 32629, 32654, 32681, 32715, 32735, 32767},
          {0,     6050,  7445,  9167,  11306, 12106, 12666, 13745, 14916, 16756,
           17885, 18822, 19274, 20361, 21338, 21859, 22497, 23084, 24271, 25221,
           25620, 26091, 27776, 28424, 29375, 29913, 30074, 30333, 30647, 30910,
           31143, 31443, 31615, 31884, 32089, 32321, 32506, 32705, 32767},
          {0,     2679,  6956,  10400, 13634, 15952, 18416, 19038, 19621, 20629,
           21786, 22182, 24335, 24789, 25050, 27247, 27683, 29110, 29571, 29820,
           29966, 30239, 30879, 31254, 31528, 31684, 31768, 31882, 32031, 32138,
           32258, 32339, 32395, 32498, 32558, 32628, 32681, 32739, 32767},
          {0,     1114,  5932,  10662, 15286, 18135, 21137, 21279, 21537, 22258,
           25401, 25644, 25853, 26058, 26298, 28722, 29632, 29765, 30895, 30997,
           31108, 31215, 31414, 31546, 31734, 31834, 31943, 32064, 32212, 32299,
           32409, 32460, 32502, 32574, 32613, 32662, 32698, 32732, 32767},
          {0,     1746,  6320,  10438, 13833, 16087, 19082, 19259, 20327, 21545,
           23659, 23900, 25815, 26373, 26659, 27901, 28677, 28818, 29032, 30766,
           30939, 31102, 31432, 31627, 31832, 31944, 32057, 32155, 32243, 32338,
           32419, 32474, 32512, 32583, 32622, 32667, 32704, 32741, 32767},
          {0,     3312,  9511,  12974, 14670, 15553, 20214, 21091, 21640, 23232,
           24116, 24462, 24973, 25465, 25782, 26721, 28129, 28318, 28692, 28937,
           29497, 29814, 30463, 30743, 31132, 31339, 31430, 31557, 31813, 31969,
           32094, 32214, 32278, 32397, 32482, 32592, 32661, 32733, 32767},
          {0,     1760,  4960,  15877, 18514, 19158, 22852, 24093, 24586, 25371,
           25814, 26141, 28194, 28536, 28715, 29018, 29373, 29619, 30002, 30189,
           30533, 30927, 31341, 31538, 31762, 31904, 31955, 32054, 32149, 32239,
           32319, 32382, 32428, 32524, 32569, 32627, 32671, 32712, 32767},
          {0,     1962,  2657,  4725,  5743,  6965,  8078,  9093,  11298, 13716,
           14863, 16412, 17403, 19661, 21279, 21751, 22219, 23348, 25242, 26704,
           27396, 28319, 28319, 29530, 30017, 30319, 30663, 30850, 31428, 31560,
           31727, 31894, 32078, 32241, 32342, 32464, 32544, 32649, 32767},
          {0,     1619,  4706,  8870,  11995, 14927, 18474, 18670, 19986, 20581,
           22796, 23232, 23499, 23821, 24170, 26674, 27092, 27503, 27768, 27974,
           28180, 28456, 29023, 31461, 31661, 31781, 31862, 31943, 32160, 32248,
           32300, 32356, 32464, 32546, 32595, 32649, 32692, 32735, 32767},
          {0,     8697,  8777,  8908,  8970,  9047,  9096,  9293,  9425,  9595,
           9680,  9774,  9811,  9905,  10027, 10064, 10092, 10174, 10242, 10305,
           10378, 10414, 10514, 10572, 13817, 19018, 19054, 21820, 21848, 23999,
           24036, 26746, 26801, 28130, 29410, 30455, 31691, 32743, 32767},
          {0,     8819,  8884,  8978,  9055,  9132,  9181,  9281,  9418,  9555,
           9630,  9767,  9834,  9945,  10053, 10109, 10149, 10235, 10377, 10473,
           10682, 10746, 10874, 10961, 13794, 16344, 16372, 20413, 20458, 25815,
           25831, 26762, 26824, 28561, 29652, 30627, 31892, 32740, 32767},
          {0,     1447,  13594, 18104, 20353, 20786, 27618, 27847, 28061, 28506,
           28841, 29067, 29185, 29364, 29580, 29875, 30355, 30517, 30716, 30908,
           31027, 31106, 31274, 31390, 31587, 31728, 32011, 32092, 32174, 32313,
           32386, 32434, 32510, 32576, 32616, 32673, 32711, 32747, 32767},
          {0,     8241,  8310,  8419,  8555,  8954,  9032,  9554,  9824,  10139,
           10353, 10563, 10647, 10891, 11045, 11183, 11264, 11380, 11609, 11791,
           11945, 12191, 12379, 12515, 17069, 18607, 18685, 24852, 24900, 26012,
           26068, 27495, 27685, 28657, 29984, 31075, 31985, 32742, 32767},
          {0,     1141,  4960,  12209, 18241, 18880, 20789, 21056, 21405, 22130,
           22460, 23114, 23639, 24188, 24631, 28135, 28264, 28564, 29020, 29410,
           29978, 30267, 30556, 30943, 31128, 31259, 31386, 31517, 32073, 32181,
           32260, 32327, 32401, 32504, 32558, 32619, 32676, 32718, 32767},
          {0,     12167, 12274, 12500, 12577, 13281, 13362, 13655, 13877, 14102,
           14299, 14627, 14720, 14883, 15017, 15071, 15173, 15285, 15402, 15528,
           15659, 15755, 15914, 16026, 17978, 20258, 20344, 21885, 21945, 24472,
           24528, 25336, 25471, 28636, 29765, 30638, 31770, 32729, 32767},
          {0,     5472,  10004, 13943, 16168, 16494, 18855, 19238, 19615, 19933,
           20747, 21018, 21424, 21923, 22164, 23067, 25043, 25245, 25583, 25769,
           26043, 26245, 26665, 26818, 27287, 27518, 27614, 27813, 27922, 28095,
           31808, 31962, 32220, 32351, 32452, 32568, 32638, 32718, 32767},
          {0,     9975,  10040, 10106, 10139, 10183, 10223, 10264, 10336, 10402,
           10434, 10486, 10519, 10566, 10610, 10637, 10659, 10705, 10752, 10793,
           10830, 10857, 10949, 10993, 13156, 15085, 15100, 17344, 17374, 18996,
           19012, 23469, 23540, 25016, 26800, 29793, 31178, 32754, 32767},
          {0,     7536,  9234,  10748, 11865, 12350, 14855, 15212, 16672, 17494,
           18034, 18809, 19151, 19823, 20719, 21185, 22265, 22601, 23162, 24261,
           24537, 24798, 25680, 26080, 26730, 27131, 27371, 27611, 27838, 28129,
           28410, 28623, 31836, 32047, 32226, 32401, 32537, 32685, 32767},
          {0,     10773, 11042, 11229, 11301, 11669, 11767, 12075, 12434, 12694,
           13130, 13372, 13518, 13790, 14018, 14290, 14458, 14630, 14784, 14968,
           15116, 15246, 15452, 15626, 17197, 20518, 20591, 21841, 21927, 23565,
           23615, 24516, 24611, 26441, 27774, 28783, 31723, 32729, 32767},
          {0,     14426, 14532, 14652, 14714, 14796, 14865, 14924, 15041, 15156,
           15213, 15292, 15383, 15467, 15550, 15618, 15680, 15747, 15826, 15885,
           15945, 15993, 16117, 16186, 17811, 19298, 19339, 20534, 20586, 21818,
           21842, 23144, 23246, 24453, 27792, 29965, 31245, 32740, 32767},
          {0,     10296, 10393, 10497, 10566, 10691, 10769, 10835, 10992, 11107,
           11166, 11260, 11329, 11425, 11501, 11569, 11623, 11686, 11808, 11870,
           11930, 11984, 12102, 12179, 13865, 15605, 15642, 17333, 17385, 18879,
           18899, 21974, 22036, 23604, 26227, 29545, 31075, 32739, 32767},
          {0,     13101, 13222, 13362, 13432, 13535, 13621, 13687, 13915, 14036,
           14100, 14193, 14331, 14435, 14524, 14591, 14670, 14751, 14831, 14912,
           14997, 15055, 15194, 15281, 17048, 18640, 18681, 20670, 20756, 22068,
           22087, 23158, 23231, 25115, 26474, 27559, 30112, 32732, 32767},
          {0,     12082, 12164, 12266, 12321, 12397, 12473, 12528, 12648, 12757,
           12810, 12894, 12958, 13035, 13116, 13171, 13235, 13303, 13388, 13452,
           13519, 13569, 13680, 13772, 15279, 16565, 16603, 17957, 18021, 19069,
           19087, 22955, 23024, 24461, 26471, 27610, 29268, 32736, 32767},
          {0,     2750,  3286,  4170,  4546,  4935,  5546,  5762,  6296,  6745,
           7026,  7244,  7440,  7672,  7943,  26911, 27065, 27190, 27484, 27743,
           27956, 29557, 29810, 29969, 30288, 30499, 30629, 30741, 30866, 31039,
           31201, 31282, 31444, 31574, 31675, 31806, 31900, 31985, 32767}};

     private:
      constexpr inline void update(int c) { m_last_byte = c; }
      uint8_t               m_last_byte = char_to_symbol['\0'];
   };

   inline constexpr uint64_t name_to_number(std::string_view m_input)
   {
      if (m_input.size() == 0 || m_input.size() > 18)
         return 0;

      name_model                       m_model;
      std::string_view::const_iterator m_in_itr(m_input.begin());
      if (*m_in_itr <= '9')
         return 0;
      for (auto i : m_input)
         if (not name_model::char_to_symbol[i])
            return 0;

      typedef typename name_model::code_value code_value;
      typedef typename name_model::prob       prob;
      typedef name_model                      MODEL;

      uint8_t       m_bit      = 0;
      uint8_t       m_NextByte = 0;
      unsigned char m_Mask     = 0x80;
      uint64_t      m_output   = 0;

      auto put_bit = [&](bool b)
      {
         if (b)
            m_NextByte |= m_Mask;
         m_Mask >>= 1;
         if (!m_Mask)
         {
            if (m_bit < 64)
            {
               m_output |= (uint64_t(m_NextByte) << m_bit);
            }

            m_bit += 8;

            m_Mask     = 0x80;
            m_NextByte = 0;
         }
      };

      auto getByte = [&]()
      {
         if (m_in_itr == m_input.end())
            return 0;
         int c = m_model.char_to_symbol[*m_in_itr];
         ++m_in_itr;
         return c;
      };

      int        pending_bits = 0;
      code_value low          = 0;
      code_value high         = name_model::MAX_CODE;

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

      if (m_Mask != 0x80)
      {
         if (m_bit < 64)
            m_output |= (uint64_t(m_NextByte) << m_bit);
         else
            m_output = 0;
      }

      if (m_in_itr != m_input.end() || c != '\0')
         return 0;

      return m_output;
   }  // name_to_number

   inline std::string number_to_name(uint64_t input)
   {
      if (not input)
         return std::string();
      typedef typename name_model::code_value code_value;
      typedef typename name_model::prob       prob;

      name_model m_model;
      int        current_byte = 0;
      uint8_t    last_mask    = 1;
      int        not_eof = 64 + 16;  // allow extra bits to be brought in as helps improve accuracy

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

      code_value high  = name_model::MAX_CODE;
      code_value low   = 0;
      code_value value = 0;
      int        count = 0;
      for (int i = 0; (i < name_model::code_value_bits) and not_eof; i++)
      {
         value <<= 1;
         value += get_bit() ? 1 : 0;
      }
      while (not_eof)
      {
         code_value range = high - low + 1;
         ++count;

         if (range == 0)
            return "RUNTIME LOGIC ERROR";

         code_value scaled_value = ((value - low + 1) * m_model.getCount() - 1) / range;
         int        c;
         prob       p = m_model.getChar(scaled_value, c);
         if (c == '\0')
            break;

         out += m_model.symbol_to_char[char(c)];

         if (p.count == 0)
            return "RUNTIME LOGIC ERROR";

         high = low + (range * p.high) / p.count - 1;
         low  = low + (range * p.low) / p.count;

         while (not_eof)
         {
            if (high < name_model::ONE_HALF)
            {
               //do nothing, bit is a zero
            }
            else if (low >= name_model::ONE_HALF)
            {
               value -= name_model::ONE_HALF;  //subtract one half from all three code values
               low -= name_model::ONE_HALF;
               high -= name_model::ONE_HALF;
            }
            else if (low >= name_model::ONE_FOURTH && high < name_model::THREE_FOURTHS)
            {
               value -= name_model::ONE_FOURTH;
               low -= name_model::ONE_FOURTH;
               high -= name_model::ONE_FOURTH;
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

   struct account_id_type
   {
      constexpr explicit account_id_type(const std::string_view s) : value(name_to_number(s)) {}
      constexpr account_id_type(uint64_t n = 0) : value(n) {}

      uint64_t value = 0;
               operator std::string() const { return number_to_name(value); }
   };

   PSIO_REFLECT(account_id_type, value);

}  // namespace psibase

