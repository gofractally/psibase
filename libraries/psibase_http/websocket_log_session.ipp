#pragma once

#include "websocket_log_session.hpp"

#include <boost/asio/buffer.hpp>
#include <boost/asio/dispatch.hpp>
#include <cstddef>
#include <span>
#include <system_error>

namespace psibase::http
{

   template <typename StreamType>
   websocket_log_session<StreamType>::websocket_log_session(StreamType&& stream)
       : reader(stream.get_executor()), stream(std::move(stream))
   {
   }

   template <typename StreamType>
   void websocket_log_session<StreamType>::write(std::shared_ptr<websocket_log_session>&& self)
   {
      auto p = self.get();
      p->reader.async_read(
          [self = std::move(self)](const std::error_code& ec, std::span<const char> data) mutable
          {
             if (!ec && !self->closed)
             {
                auto p = self.get();
                p->stream.async_write(
                    boost::asio::buffer(data.data(), data.size()),
                    [self = std::move(self)](const std::error_code& ec, std::size_t) mutable
                    {
                       if (!ec && !self->closed)
                       {
                          auto p = self.get();
                          write(std::move(self));
                       }
                    });
             }
          });
   }

   template <typename StreamType>
   void websocket_log_session<StreamType>::read(std::shared_ptr<websocket_log_session>&& self)
   {
      auto p = self.get();
      p->buffer.clear();
      p->stream.async_read(
          p->buffer,
          [self = std::move(self)](const std::error_code& ec, std::size_t) mutable
          {
             if (!ec)
             {
                auto data = self->buffer.cdata();
                try
                {
                   self->reader.config({static_cast<const char*>(data.data()), data.size()});
                }
                catch (std::exception& e)
                {
                   close(std::move(self),
                         {boost::beast::websocket::close_code::policy_error, e.what()});
                   return;
                }
                read(std::move(self));
             }
          });
   }

   template <typename StreamType>
   void websocket_log_session<StreamType>::run(std::shared_ptr<websocket_log_session>&& self)
   {
      read(std::shared_ptr(self));
      write(std::move(self));
   }

   template <typename StreamType>
   void websocket_log_session<StreamType>::close(std::shared_ptr<websocket_log_session>&& self,
                                                 boost::beast::websocket::close_reason    reason)
   {
      if (!self->closed)
      {
         self->closed = true;
         self->reader.cancel();
         auto p = self.get();
         p->stream.async_close(reason, [self = std::move(self)](const std::error_code&) {});
      }
   }

   template <typename StreamType>
   void websocket_log_session<StreamType>::close(std::shared_ptr<websocket_log_session>&& self,
                                                 bool                                     restart)
   {
      auto p = self.get();
      boost::asio::dispatch(
          p->stream.get_executor(),
          [restart, self = std::move(self)]() mutable
          {
             close(std::move(self),
                   boost::beast::websocket::close_reason{
                       restart ? boost::beast::websocket::close_code::service_restart
                               : boost::beast::websocket::close_code::going_away});
          });
   }
}  // namespace psibase::http
