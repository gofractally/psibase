#pragma once

#include <psibase/ForkDb.hpp>
#include <psibase/bft.hpp>
#include <psibase/blocknet.hpp>
#include <psibase/cft.hpp>
#include <psibase/node.hpp>
#include <psibase/peer_manager.hpp>
#include <psibase/shortest_path_routing.hpp>

#include <boost/asio/system_timer.hpp>

using timer_type = boost::asio::system_timer;

template <typename Derived>
using cft_consensus =
    psibase::net::basic_cft_consensus<psibase::net::blocknet<Derived, timer_type>, timer_type>;

template <typename Derived>
using bft_consensus =
    psibase::net::basic_bft_consensus<psibase::net::blocknet<Derived, timer_type>, timer_type>;

template <typename Derived, typename Timer>
using basic_consensus = psibase::net::basic_bft_consensus<
    psibase::net::basic_cft_consensus<psibase::net::blocknet<Derived, Timer>, Timer>,
    Timer>;

template <typename Derived>
using consensus = basic_consensus<Derived, timer_type>;

using psinode = psibase::net::node<psibase::net::peer_manager,
                                   psibase::net::shortest_path_routing,
                                   consensus,
                                   psibase::ForkDb>;
