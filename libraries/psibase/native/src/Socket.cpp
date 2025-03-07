#include <psibase/Socket.hpp>

using namespace psibase;

static constexpr auto wasi_errno_acces  = 2;
static constexpr auto wasi_errno_badf   = 8;
static constexpr auto wasi_errno_notsup = 58;

Socket::~Socket()
{
   if (auto sockets = weak_sockets.lock())
   {
      std::lock_guard l{sockets->mutex};
      sockets->available.set(id);
   }
}

bool Socket::canAutoClose() const
{
   return false;
}

bool AutoCloseSocket::canAutoClose() const
{
   return true;
}

void SocketAutoCloseSet::close(Writer&                           writer,
                               Sockets&                          parent,
                               const std::optional<std::string>& message)
{
   for (const auto& socket : sockets)
   {
      socket->autoClose(message);
   }

   {
      std::lock_guard l{parent.mutex};
      for (const auto& socket : sockets)
      {
         auto key = socketKey(socket->id);
         parent.sharedDb.kvRemoveSubjective(writer, psio::convert_to_key(key));
         socket->closed = true;
         parent.sockets[static_cast<std::size_t>(socket->id)].reset();
      }
   }
   sockets.clear();
}
SocketAutoCloseSet::~SocketAutoCloseSet()
{
   assert(sockets.empty() && "SocketAutoCloseSet must be explicitly closed before being destroyed");
}

bool SocketAutoCloseSet::owns(Sockets& sockets, const AutoCloseSocket& sock)
{
   std::lock_guard l{sockets.mutex};
   return sock.owner == this;
}

namespace
{
   struct NullProducersSocket : Socket
   {
      virtual void       send(std::span<const char>) override {}
      virtual SocketInfo info() const override { return ProducerMulticastSocketInfo{}; }
   };

   struct NullHttpSocket : AutoCloseSocket
   {
      NullHttpSocket() { once = true; }
      virtual void       send(std::span<const char>) override {}
      virtual void       autoClose(const std::optional<std::string>&) noexcept override {}
      virtual SocketInfo info() const override { return HttpSocketInfo{}; }
   };

   void doRemoveSocket(std::shared_ptr<Socket>& socket, SharedDatabase& sharedDb, Writer& writer)
   {
      assert(!socket->closed);
      if (socket->canAutoClose())
      {
         auto sockptr = std::static_pointer_cast<AutoCloseSocket>(socket);
         if (sockptr->owner)
            sockptr->owner->sockets.erase(sockptr);
      }
      {
         auto key = socketKey(socket->id);
         sharedDb.kvRemoveSubjective(writer, psio::convert_to_key(key));
      }
      socket->closed = true;
      socket.reset();
   }

   struct MakeNullSocketVisitor
   {
      std::shared_ptr<Socket> operator()(const ProducerMulticastSocketInfo&)
      {
         return std::make_shared<NullProducersSocket>();
      }
      std::shared_ptr<Socket> operator()(const HttpSocketInfo&)
      {
         return std::make_shared<NullHttpSocket>();
      }
   };
}  // namespace

Sockets::Sockets(SharedDatabase sharedDb) : sharedDb(std::move(sharedDb))
{
   // emptyRevision is okay, because we only need the subjective db
   Database db{this->sharedDb, sharedDb.emptyRevision()};
   auto     session = db.startRead();
   db.checkoutSubjective();
   auto                   key       = psio::convert_to_key(socketPrefix());
   auto                   prefixLen = key.size();
   std::vector<SocketRow> rows;
   while (auto kv = db.kvGreaterEqualRaw(SocketRow::db, key, prefixLen))
   {
      auto row = psio::from_frac<SocketRow>(std::span{kv->value.pos, kv->value.end});
      check(row.fd >= 0, "invalid fd");
      rows.push_back(row);
      key.assign(kv->key.pos, kv->key.end);
      key.push_back(0);
   }

   if (!rows.empty())
   {
      auto maxFd = static_cast<std::size_t>(rows.back().fd);
      available.resize(maxFd + 1, true);
      sockets.resize(maxFd + 1);
      for (const auto& row : rows)
      {
         auto pos  = static_cast<std::size_t>(row.fd);
         auto sock = std::visit(MakeNullSocketVisitor{}, row.info);
         sock->id  = row.fd;
         available.reset(pos);
         sockets[pos] = std::move(sock);
      }
   }
}

void Sockets::shutdown()
{
   std::unique_lock l{mutex};
   stopped         = true;
   auto tmpsockets = std::move(sockets);
   l.unlock();
   tmpsockets.clear();
}

std::int32_t Sockets::send(Writer& writer, std::int32_t fd, std::span<const char> buf)
{
   std::shared_ptr<Socket> p;
   {
      std::lock_guard l{mutex};
      if (fd >= 0 && fd < sockets.size())
         p = sockets[fd];
      if (!p)
         return wasi_errno_badf;
      if (p->once)
      {
         doRemoveSocket(sockets[fd], sharedDb, writer);
      }
   }

   p->send(buf);
   return 0;
}
void Sockets::add(Writer& writer, const std::shared_ptr<Socket>& socket, SocketAutoCloseSet* owner)
{
   std::lock_guard l{mutex};
   check(!stopped, "Shutting down");
   if (auto pos = available.find_first(); pos != boost::dynamic_bitset<>::npos)
   {
      socket->id   = pos;
      sockets[pos] = socket;
      available.reset(pos);
   }
   else
   {
      check(sockets.size() <= static_cast<std::uint32_t>(std::numeric_limits<std::int32_t>::max()),
            "Too many open sockets");

      // TODO: exception safety
      socket->id = sockets.size();
      sockets.push_back(socket);
      available.push_back(false);
   }
   {
      SocketRow row{socket->id, socket->info()};
      sharedDb.kvPutSubjective(writer, psio::convert_to_key(row.key()), psio::to_frac(row));
   }
   if (owner)
   {
      assert(socket->canAutoClose());
      auto sockptr   = std::static_pointer_cast<AutoCloseSocket>(socket);
      sockptr->owner = owner;
      owner->sockets.insert(sockptr);
   }
   socket->weak_sockets = shared_from_this();
}
void Sockets::set(Writer& writer, std::int32_t fd, const std::shared_ptr<Socket>& socket)
{
   std::lock_guard l{mutex};
   check(!stopped, "Shutting down");
   check(fd >= 0, "invalid fd");
   auto pos = static_cast<std::size_t>(fd);
   if (pos + 1 > available.size())
   {
      available.resize(pos + 1, true);
      sockets.resize(pos + 1);
   }
   if (!available[pos])
   {
      check(sockets[pos]->info() == socket->info(), "Replacing socket does not match");
      sockets[pos]->weak_sockets.reset();
      sockets[pos] = socket;
   }
   else
   {
      socket->id   = fd;
      sockets[pos] = socket;
      available.reset(pos);
      SocketRow row{socket->id, socket->info()};
      sharedDb.kvPutSubjective(writer, psio::convert_to_key(row.key()), psio::to_frac(row));
   }

   socket->weak_sockets = shared_from_this();
}
void Sockets::remove(Writer& writer, const std::shared_ptr<Socket>& socket)
{
   std::lock_guard l{mutex};
   if (socket->id >= 0 && socket->id < sockets.size() && sockets[socket->id] == socket)
   {
      doRemoveSocket(sockets[socket->id], sharedDb, writer);
   }
}
std::int32_t Sockets::autoClose(std::int32_t               fd,
                                bool                       value,
                                SocketAutoCloseSet*        owner,
                                std::vector<SocketChange>* diff)
{
   std::shared_ptr<AutoCloseSocket> sockptr;
   {
      std::lock_guard l{mutex};
      if (fd < 0 || fd >= sockets.size() || !sockets[fd])
         return wasi_errno_badf;
      auto p = sockets[fd];

      if (!p->canAutoClose())
         return wasi_errno_notsup;

      sockptr = std::static_pointer_cast<AutoCloseSocket>(p);

      if (sockptr->owner && sockptr->owner != owner)
         return wasi_errno_acces;

      if (!diff)
         sockptr->owner = value ? owner : nullptr;
   }

   if (diff)
   {
      diff->push_back({sockptr, value ? owner : nullptr});
   }
   else
   {
      if (value)
         owner->sockets.insert(sockptr);
      else
         owner->sockets.erase(sockptr);
   }
   return 0;
}
bool Sockets::applyChanges(const std::vector<SocketChange>& diff, SocketAutoCloseSet* owner)
{
   std::lock_guard l{mutex};
   for (const auto& change : diff)
   {
      if (change.socket->closed || change.socket->owner && change.socket->owner != owner)
         return false;
   }
   for (const auto& change : diff)
   {
      if (change.socket->owner && !change.owner)
      {
         owner->sockets.erase(change.socket);
      }
      else if (!change.socket->owner && change.owner)
      {
         owner->sockets.insert(change.socket);
      }
      change.socket->owner = change.owner;
   }
   return true;
}
