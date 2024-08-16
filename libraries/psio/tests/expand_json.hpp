#pragma once

#include <psio/check.hpp>
#include <psio/shared_view_ptr.hpp>
#include <psio/stream.hpp>
#include <string>

namespace psio
{

   template <typename S>
   struct expand_shared_view_ptr_stream : S
   {
      using S::S;
   };

   template <typename T, typename S>
   void to_json(const shared_view_ptr<T>& obj, expand_shared_view_ptr_stream<S>& stream)
   {
      to_json(obj->unpack(), stream);
   }

   std::string expand_json(const auto& t)
   {
      expand_shared_view_ptr_stream<size_stream> ss;
      to_json(t, ss);
      std::string                                     result(ss.size, 0);
      expand_shared_view_ptr_stream<fixed_buf_stream> fbs(result.data(), result.size());
      to_json(t, fbs);
      if (fbs.pos != fbs.end)
         abort_error(stream_error::underrun);
      return result;
   }

}  // namespace psio
