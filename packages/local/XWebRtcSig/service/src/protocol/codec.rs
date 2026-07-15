use serde_json::Value;

use super::frames::{ClientFrame, ServerFrame};
use super::types::{ProtocolError, SignalKind};

pub fn parse_client_frame(input: &[u8]) -> Result<ClientFrame, ProtocolError> {
    let value: Value = serde_json::from_slice(input)
        .map_err(|err| ProtocolError::MalformedJson(err.to_string()))?;
    let frame_type = value
        .get("t")
        .and_then(Value::as_str)
        .ok_or_else(|| ProtocolError::InvalidFrame("frame discriminator `t` is required".into()))?;

    const KNOWN: &[&str] = &[
        "clientReady",
        "ping",
        "joinSession",
        "signal",
        "leaveSession",
        "participantState",
    ];
    if !KNOWN.iter().any(|k| *k == frame_type) {
        return Err(ProtocolError::UnknownFrameType(frame_type.into()));
    }

    serde_json::from_value(value).map_err(|err| ProtocolError::InvalidFrame(err.to_string()))
}

pub fn encode_server_frame(frame: &ServerFrame) -> Result<String, ProtocolError> {
    serde_json::to_string(frame).map_err(|err| ProtocolError::InvalidFrame(err.to_string()))
}

pub fn decode_server_frame_json(json: &str) -> Result<ServerFrame, ProtocolError> {
    serde_json::from_str(json).map_err(|err| ProtocolError::InvalidFrame(err.to_string()))
}

pub fn validate_client_frame(frame: &ClientFrame) -> Result<(), ProtocolError> {
    match frame {
        ClientFrame::ClientReady {
            client_instance_id, ..
        } => validate_required_id("clientInstanceId", client_instance_id),
        ClientFrame::Ping => Ok(()),
        ClientFrame::JoinSession {
            session_id,
            client_instance_id,
        } => {
            validate_required_id("sessionId", session_id)?;
            validate_required_id("clientInstanceId", client_instance_id)
        }
        ClientFrame::Signal {
            session_id,
            to: _,
            kind,
            sdp,
            candidate,
            sdp_mid,
            sdp_mline_index,
        } => {
            validate_required_id("sessionId", session_id)?;
            validate_signal_payload(*kind, sdp, candidate, sdp_mid, sdp_mline_index)
        }
        ClientFrame::LeaveSession { session_id, .. } => {
            validate_required_id("sessionId", session_id)
        }
        ClientFrame::ParticipantState { session_id, .. } => {
            validate_required_id("sessionId", session_id)
        }
    }
}

fn validate_signal_payload(
    kind: SignalKind,
    sdp: &Option<String>,
    candidate: &Option<String>,
    sdp_mid: &Option<String>,
    sdp_mline_index: &Option<u32>,
) -> Result<(), ProtocolError> {
    match kind {
        SignalKind::Offer | SignalKind::Answer => {
            if sdp.as_ref().map(|s| s.trim().is_empty()).unwrap_or(true) {
                return Err(ProtocolError::InvalidFrame(format!(
                    "signal kind {:?} requires non-empty sdp",
                    kind
                )));
            }
            Ok(())
        }
        SignalKind::Candidate => {
            if candidate.as_ref().map(|s| s.trim().is_empty()).unwrap_or(true) {
                return Err(ProtocolError::InvalidFrame(
                    "signal kind candidate requires candidate".into(),
                ));
            }
            Ok(())
        }
        SignalKind::EndOfCandidates => {
            if sdp.is_some() || candidate.is_some() || sdp_mid.is_some() || sdp_mline_index.is_some()
            {
                return Err(ProtocolError::InvalidFrame(
                    "signal kind end-of-candidates must not include sdp/candidate fields".into(),
                ));
            }
            Ok(())
        }
    }
}

fn validate_required_id(field: &str, value: &str) -> Result<(), ProtocolError> {
    if value.trim().is_empty() {
        return Err(ProtocolError::InvalidFrame(format!(
            "{field} must not be empty"
        )));
    }
    Ok(())
}
