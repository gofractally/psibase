#pragma once
#include <sys/event.h>
#include <unistd.h>
#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstdint>
#include <exception>
#include <mutex>
#include <system_error>
namespace psibase
{
   class DarwinWatchdogWake
   {
      int fd = kqueue();

     public:
      DarwinWatchdogWake()
      {
         if (fd < 0)
            throw std::system_error(errno, std::system_category());
         struct kevent event;
         EV_SET(&event, 1, EVFILT_USER, EV_ADD | EV_CLEAR, 0, 0, nullptr);
         if (kevent(fd, &event, 1, nullptr, 0, nullptr) < 0)
         {
            const auto error = errno;
            close(fd);
            throw std::system_error(error, std::system_category());
         }
      }
      ~DarwinWatchdogWake() { close(fd); }
      void notify_one()
      {
         struct kevent event;
         EV_SET(&event, 1, EVFILT_USER, 0, NOTE_TRIGGER, 0, nullptr);
         if (kevent(fd, &event, 1, nullptr, 0, nullptr) < 0)
            std::terminate();
      }
      void wait_for(std::unique_lock<std::mutex>& lock, std::chrono::nanoseconds duration)
      {
         struct kevent timer, event;
         EV_SET(&timer, 2, EVFILT_TIMER, EV_ADD | EV_ONESHOT, NOTE_NSECONDS | NOTE_CRITICAL,
                std::max(std::int64_t(1), duration.count()), nullptr);
         if (kevent(fd, &timer, 1, nullptr, 0, nullptr) < 0)
            throw std::system_error(errno, std::system_category());
         lock.unlock();
         int count;
         do
         {
            count = kevent(fd, nullptr, 0, &event, 1, nullptr);
         } while (count < 0 && errno == EINTR);
         lock.lock();
         if (count < 0 || (event.flags & EV_ERROR))
            throw std::system_error(count < 0 ? errno : int(event.data), std::system_category());
      }
   };
}  // namespace psibase
