#pragma once

// A response body that is part of a file: `length` bytes from `offset`,
// read and sent a piece at a time. Beast's own file body sends a whole file
// in 4 KiB pieces; this one sends a range, in pieces sized for throughput.

#include <boost/asio/buffer.hpp>
#include <boost/beast/core/error.hpp>
#include <boost/beast/http/error.hpp>
#include <boost/beast/http/message.hpp>
#include <boost/optional.hpp>

#include <unistd.h>
#include <algorithm>
#include <cerrno>
#include <cstdint>
#include <utility>
#include <vector>

namespace psibase::http
{
   struct range_file_body
   {
      struct value_type
      {
         int           fd     = -1;
         std::uint64_t offset = 0;
         std::uint64_t length = 0;

         value_type() = default;
         value_type(int fd, std::uint64_t offset, std::uint64_t length)
             : fd(fd), offset(offset), length(length)
         {
         }
         value_type(value_type&& other) noexcept
             : fd(std::exchange(other.fd, -1)), offset(other.offset), length(other.length)
         {
         }
         value_type& operator=(value_type&& other) noexcept
         {
            if (this != &other)
            {
               reset();
               fd     = std::exchange(other.fd, -1);
               offset = other.offset;
               length = other.length;
            }
            return *this;
         }
         value_type(const value_type&)            = delete;
         value_type& operator=(const value_type&) = delete;
         ~value_type() { reset(); }
         void reset()
         {
            if (fd >= 0)
               ::close(fd);
            fd = -1;
         }
      };

      static std::uint64_t size(const value_type& body) { return body.length; }

      class writer
      {
        public:
         using const_buffers_type = boost::asio::const_buffer;

         template <bool isRequest, class Fields>
         writer(boost::beast::http::header<isRequest, Fields>&, value_type& body)
             : body_(body),
               pos_(body.offset),
               remain_(body.length),
               buf_(static_cast<std::size_t>(std::min<std::uint64_t>(body.length, pieceSize)))
         {
         }

         void init(boost::beast::error_code& ec) { ec = {}; }

         boost::optional<std::pair<const_buffers_type, bool>> get(boost::beast::error_code& ec)
         {
            ec = {};
            if (remain_ == 0)
               return boost::none;
            auto want = static_cast<std::size_t>(std::min<std::uint64_t>(remain_, buf_.size()));
            ssize_t n;
            do
            {
               n = ::pread(body_.fd, buf_.data(), want, static_cast<off_t>(pos_));
            } while (n < 0 && errno == EINTR);
            if (n < 0)
            {
               ec = boost::beast::error_code(errno, boost::system::system_category());
               return boost::none;
            }
            if (n == 0)
            {
               // The file is shorter than the headers already promised.
               ec = boost::beast::http::error::short_read;
               return boost::none;
            }
            pos_ += static_cast<std::uint64_t>(n);
            remain_ -= static_cast<std::uint64_t>(n);
            return {{const_buffers_type{buf_.data(), static_cast<std::size_t>(n)}, remain_ > 0}};
         }

        private:
         static constexpr std::uint64_t pieceSize = 256 * 1024;
         value_type&                    body_;
         std::uint64_t                  pos_;
         std::uint64_t                  remain_;
         std::vector<char>              buf_;
      };
   };
}  // namespace psibase::http
