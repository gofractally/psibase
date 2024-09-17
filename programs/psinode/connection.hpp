#pragma once

#include <psibase/http.hpp>
#include <psibase/websocket.hpp>

extern template class psibase::net::websocket_connection<
    psibase::http::accept_p2p_websocket1::next_layer_type>;
#ifdef PSIBASE_ENABLE_SSL
extern template class psibase::net::websocket_connection<
    psibase::http::accept_p2p_websocket2::next_layer_type>;
#endif
extern template class psibase::net::websocket_connection<
    psibase::http::accept_p2p_websocket3::next_layer_type>;
