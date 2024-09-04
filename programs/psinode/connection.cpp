#include <psibase/http.hpp>
#include <psibase/websocket.hpp>

template class psibase::net::websocket_connection<
    psibase::http::accept_p2p_websocket1::next_layer_type>;
#ifdef PSIBASE_ENABLE_SSL
template class psibase::net::websocket_connection<
    psibase::http::accept_p2p_websocket2::next_layer_type>;
#endif
template class psibase::net::websocket_connection<
    psibase::http::accept_p2p_websocket3::next_layer_type>;
