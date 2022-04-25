#pragma once
#include <psio/stream.hpp>

namespace psio
{
   // TODO: test this for faster compression... https://github.com/charlesw1234/densityxx
   // C https://github.com/k0dai/density#quick-start-a-simple-example-using-the-api
   //

   // https://jameshfisher.com/2017/01/24/bitwise-check-for-zero-byte/
   constexpr bool contains_zero_byte(uint64_t v) {
     return (v - uint64_t(0x0101010101010101)) & ~(v) & uint64_t(0x8080808080808080);
   }

   /// TODO: test and finish this
   void capp_pack2(const uint8_t* begin, const uint8_t* end, uint8_t* obegin, uint8_t* oend ) {

        auto ipos = begin;
        auto opos = obegin;

        while( ipos < end ) {
           uint8_t bits = 0;
           bits = (0x01 & -uint8_t(ipos[0]!=0))
                | (0x02 & -uint8_t(ipos[1]!=0))
                | (0x04 & -uint8_t(ipos[2]!=0))
                | (0x08 & -uint8_t(ipos[3]!=0))
                | (0x10 & -uint8_t(ipos[4]!=0))
                | (0x20 & -uint8_t(ipos[5]!=0))
                | (0x40 & -uint8_t(ipos[6]!=0))
                | (0x80 & -uint8_t(ipos[7]!=0));

           *opos = bits; ++opos;
           for( uint32_t i = 0; i < 8; ++i ) {
              *opos = ipos[i];
              opos += bits & 0x01;
              bits >>= 1; 
           }
           ipos += 8;
        }
   }

   /// TODO: test and finish this
   void capp_unpack2(const uint8_t* begin, const uint8_t* end, uint8_t* obegin, uint8_t* oend ) {
        auto inpos = begin;
        auto opos  = obegin;
        while( inpos != end ) {
           uint8_t word_bits = *inpos;
           ++inpos;
           
           for( uint32_t i = 0; i < 8; ++i ) {
              const uint8_t bit = word_bits & 0x01;
              *opos = -bit & *inpos; 
              opos++;
              inpos += bit;
              word_bits >>= 1;
           }
        }
   }


   template <typename InStream, typename OutStream>
   void capp_unpack(InStream& in, OutStream& out)
   {
      while (in.remaining())
      {
         uint8_t word_bits;
         in.read(&word_bits, 1);

         const uint64_t zero_word = 0;

         if (word_bits == 0x00)
         {
            out.write(&zero_word, 8);

            uint8_t zero_words;
            in.read(&zero_words, 1);

            while (zero_words)
            {
               out.write(&zero_word, 8);
               --zero_words;
            }
            if (in.pos >= in.end)
            {
               abort_error(psio::stream_error::overrun);
            }
         }
         else if (word_bits == 0xff)
         {
            if (in.remaining() < 8)
            {
               out.write(in.pos, in.remaining());
               in.skip(in.remaining());
               return;
            }

            uint64_t word;
            in.read(&word, sizeof(word));
            out.write(&word, 8);

            uint8_t raw_words;
            in.read(&raw_words, 1);
            if (raw_words)
            {
               if (in.remaining() < uint32_t(raw_words * 8))
                  abort_error(psio::stream_error::overrun);
               out.write(in.pos, uint32_t(raw_words) * 8);
               in.pos += uint32_t(raw_words) * 8;
            }
         }
         else
         {
            uint64_t out_word = 0;
            uint8_t* out_p    = (uint8_t*)&out_word;
            for (auto i = 7; i >= 0; --i)
            {
               if (word_bits & (1 << i))
               {
                  in.read(out_p, 1);
                  out_p++;
               }
               else
               {
                  out_p++;
               }
            }
            out.write(&out_word, sizeof(out_word));
         }
      }
   }

   template <typename InStream, typename OutStream>
   void capp_pack(InStream& in, OutStream& out)
   {
      while (in.remaining() >= 8)
      {
         uint64_t next_word;
         in.read_raw(next_word);

         if (not next_word)
         {
            out.write(char(0));

            uint32_t num_zero = 0;
            in.read_raw(next_word);

            while (not next_word && num_zero < 254)
            {
               in.read_raw(next_word);
               ++num_zero;
            }
            out.write(char(num_zero));
         }

         uint8_t* inbyte = (uint8_t*)&next_word;
         uint8_t* endin  = inbyte + 8;

         uint8_t  temp[9];
         uint8_t& zeros   = temp[0];
         uint8_t* outbyte = &temp[1];
         zeros            = 0;

         do
         {
            zeros <<= 1;
            if (bool(*inbyte))
            {
               zeros += 1;
               *outbyte = *inbyte;
               ++outbyte;
            }
            ++inbyte;
         } while (inbyte != endin);
         out.write(temp, outbyte - temp);

         if (zeros == 0xff)
         {
            uint8_t num_raw = 0;
            auto*   p       = in.pos;
            auto*   e       = in.end;
            while (*p and p != e)
               ++p;

            num_raw = (p - in.pos) / 8;
            out.write(num_raw);
            out.write(in.pos, num_raw * 8);
            in.skip(num_raw * 8);

            //  in.read_raw(next_word);
            /// TODO: once we enter "raw" mode we shouldn't exit until
            /// we have seen a certain percentage of zero bytes... for example,
            /// one zero per word isn't worth encoding...
         }
      }
      if (in.remaining())
      {
         out.write(char(0xff));  /// indicate all bytes are present, receiver will truncate
         out.write(in.pos, in.remaining());
         in.skip(in.remaining());
      }
      return;
   };

   inline std::vector<char> capn_compress(const std::vector<char>& c)
   {
      psio::input_stream in(c.data(), c.size());
      /*
    psio::size_stream sizess;
    capp_unpack( in, sizess);
    in.pos = c.data();
    */

      std::vector<char> out;
      out.reserve(c.size());
      psio::vector_stream vout(out);
      capp_pack(in, vout);
      return out;
   }
   inline std::vector<char> capn_uncompress(const std::vector<char>& c)
   {
      psio::input_stream in(c.data(), c.size());
      /*
    psio::size_stream sizess;
    capp_unpack( in, sizess);
    in.pos = c.data();
    */

      std::vector<char> out;
      out.reserve(c.size() * 1.5);
      psio::vector_stream vout(out);
      capp_unpack(in, vout);
      return out;
   }

}  // namespace psio
