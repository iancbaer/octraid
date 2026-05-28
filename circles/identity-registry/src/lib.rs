use rust_circle_sdk::{decode_request, Host, Value};

// State layout (Option C: flat index keys + JSON blob records)
//
// agent:{id}            → JSON blob of AgentRecord
// principal:{addr}:agents → comma-delimited list of agent IDs
// agents:count          → u64 total agent count
//
// Agent IDs: "agt_" + first 16 hex chars of sha256(agent_address)
// Cross-Circle validation: not supported by Octra runtime (no host_call_circle).
// All cross-registry checks happen in the off-chain API layer.
// Upgrade path: refactor to use cross-Circle calls when supported by Octra runtime.

const MANIFEST: &str = r#"{"methods":[
  {"name":"register","view":false},
  {"name":"set_agent_uri","view":false},
  {"name":"set_status","view":false},
  {"name":"get_agent","view":true},
  {"name":"get_agents_by_principal","view":true},
  {"name":"get_total_agents","view":true}
]}"#;

fn agent_key(agent_id: &str) -> String {
    format!("agent:{}", agent_id)
}

fn principal_key(principal_addr: &str) -> String {
    format!("principal:{}:agents", principal_addr)
}

// Simple hex encoding for address-derived IDs (no std sha256 in no_std WASM).
// We use a djb2-style hash over bytes to produce a deterministic 16-char hex ID.
fn derive_agent_id(agent_address: &str) -> String {
    let bytes = agent_address.as_bytes();
    let mut h: u64 = 5381;
    for &b in bytes {
        h = h.wrapping_mul(33).wrapping_add(b as u64);
    }
    // XOR-fold with a second pass for better distribution
    let mut h2: u64 = 0x9e3779b97f4a7c15;
    for &b in bytes.iter().rev() {
        h2 = h2.wrapping_mul(31).wrapping_add(b as u64);
    }
    let combined = h ^ (h2 << 32) ^ (h2 >> 32);
    format!("agt_{:016x}", combined)
}

fn add_to_index(principal_addr: &str, agent_id: &str) -> Result<(), i32> {
    let key = principal_key(principal_addr);
    let current = Host::kv_get_string(&key)?.unwrap_or_default();
    let updated = if current.is_empty() {
        agent_id.to_owned()
    } else {
        format!("{},{}", current, agent_id)
    };
    Host::kv_put_string(&key, &updated)
}

fn increment_total() -> Result<(), i32> {
    let current: u64 = Host::kv_get_string("agents:count")?
        .unwrap_or_else(|| "0".to_owned())
        .parse()
        .map_err(|_| 60)?;
    Host::kv_put_string("agents:count", &(current + 1).to_string())
}

fn get_agent_json(agent_id: &str) -> Result<Option<String>, i32> {
    Host::kv_get_string(&agent_key(agent_id))
}

fn register(request: &rust_circle_sdk::Request) -> i32 {
    let agent_address = match request.string_param(0) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let principal_address = match request.string_param(1) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let agent_uri = match request.string_param(2) {
        Ok(v) => v,
        Err(e) => return e,
    };

    // Caller must be the principal
    let caller = match Host::caller() {
        Ok(c) => c,
        Err(e) => return e,
    };
    if caller != principal_address {
        return 70; // unauthorized
    }

    let agent_id = derive_agent_id(agent_address);

    // Reject duplicate registrations
    if let Ok(Some(_)) = get_agent_json(&agent_id) {
        return 71; // already registered
    }

    let epoch = Host::epoch();
    let record = format!(
        r#"{{"agent_id":"{}","agent_address":"{}","principal_address":"{}","agent_uri":"{}","registered_at":{},"status":"Active"}}"#,
        agent_id, agent_address, principal_address, agent_uri, epoch
    );

    if let Err(e) = Host::kv_put_string(&agent_key(&agent_id), &record) {
        return e;
    }
    if let Err(e) = add_to_index(principal_address, &agent_id) {
        return e;
    }
    if let Err(e) = increment_total() {
        return e;
    }

    let event = format!(r#"{{"event":"AgentRegistered","agent_id":"{}","principal":"{}","epoch":{}}}"#,
        agent_id, principal_address, epoch);
    let _ = Host::emit_event("octraid.identity", event.as_bytes());

    Host::respond_value(Value::String(agent_id.to_owned()))
}

fn set_agent_uri(request: &rust_circle_sdk::Request) -> i32 {
    let agent_id = match request.string_param(0) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let new_uri = match request.string_param(1) {
        Ok(v) => v,
        Err(e) => return e,
    };

    let caller = match Host::caller() {
        Ok(c) => c,
        Err(e) => return e,
    };

    let json = match get_agent_json(agent_id) {
        Ok(Some(j)) => j,
        Ok(None) => return 72, // not found
        Err(e) => return e,
    };

    // Extract principal from JSON (simple string search — no serde in no_std WASM)
    if !json.contains(&format!(r#""principal_address":"{}""#, caller)) {
        return 70; // unauthorized
    }

    // Replace agent_uri value in JSON blob
    let updated = replace_json_string_field(&json, "agent_uri", new_uri);
    if let Err(e) = Host::kv_put_string(&agent_key(agent_id), &updated) {
        return e;
    }

    let event = format!(r#"{{"event":"AgentUriUpdated","agent_id":"{}","epoch":{}}}"#,
        agent_id, Host::epoch());
    let _ = Host::emit_event("octraid.identity", event.as_bytes());

    Host::respond_value(Value::Bool(true))
}

fn set_status(request: &rust_circle_sdk::Request) -> i32 {
    let agent_id = match request.string_param(0) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let new_status = match request.string_param(1) {
        Ok(v) => v,
        Err(e) => return e,
    };

    // Validate status value
    if new_status != "Active" && new_status != "Suspended" && new_status != "Revoked" {
        return 73; // invalid status
    }

    let caller = match Host::caller() {
        Ok(c) => c,
        Err(e) => return e,
    };

    let json = match get_agent_json(agent_id) {
        Ok(Some(j)) => j,
        Ok(None) => return 72, // not found
        Err(e) => return e,
    };

    if !json.contains(&format!(r#""principal_address":"{}""#, caller)) {
        return 70; // unauthorized
    }

    // Revoked agents cannot be reactivated
    if json.contains(r#""status":"Revoked""#) && new_status != "Revoked" {
        return 74; // cannot reactivate revoked agent
    }

    let updated = replace_json_string_field(&json, "status", new_status);
    if let Err(e) = Host::kv_put_string(&agent_key(agent_id), &updated) {
        return e;
    }

    let event = format!(r#"{{"event":"AgentStatusChanged","agent_id":"{}","status":"{}","epoch":{}}}"#,
        agent_id, new_status, Host::epoch());
    let _ = Host::emit_event("octraid.identity", event.as_bytes());

    Host::respond_value(Value::Bool(true))
}

// Replace a string field value in a simple JSON object.
// Only works for string fields (quoted values). Good enough for our controlled record format.
fn replace_json_string_field(json: &str, field: &str, new_value: &str) -> String {
    let needle = format!(r#""{}":""#, field);
    if let Some(start) = json.find(&needle) {
        let value_start = start + needle.len();
        if let Some(end_offset) = json[value_start..].find('"') {
            let mut result = String::with_capacity(json.len() + new_value.len());
            result.push_str(&json[..value_start]);
            result.push_str(new_value);
            result.push_str(&json[value_start + end_offset..]);
            return result;
        }
    }
    json.to_owned()
}

fn run_query(ptr: i32, len: i32) -> i32 {
    let request = match decode_request(ptr, len) {
        Ok(r) => r,
        Err(e) => return e,
    };

    match request.method.as_str() {
        "get_agent" => {
            let agent_id = match request.string_param(0) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match get_agent_json(agent_id) {
                Ok(Some(json)) => Host::respond_value(Value::String(json.to_owned())),
                Ok(None) => Host::respond_value(Value::Null),
                Err(e) => e,
            }
        }

        "get_agents_by_principal" => {
            let principal = match request.string_param(0) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match Host::kv_get_string(&principal_key(principal)) {
                Ok(Some(list)) => Host::respond_value(Value::String(list.to_owned())),
                Ok(None) => Host::respond_value(Value::String(String::new())),
                Err(e) => e,
            }
        }

        "get_total_agents" => {
            match Host::kv_get_string("agents:count") {
                Ok(Some(count)) => Host::respond_value(Value::Int(count.to_owned())),
                Ok(None) => Host::respond_value(Value::Int("0".to_owned())),
                Err(e) => e,
            }
        }

        _ => 61,
    }
}

fn run_update(ptr: i32, len: i32) -> i32 {
    let request = match decode_request(ptr, len) {
        Ok(r) => r,
        Err(e) => return e,
    };

    match request.method.as_str() {
        "register" => register(&request),
        "set_agent_uri" => set_agent_uri(&request),
        "set_status" => set_status(&request),
        _ => 62,
    }
}

#[no_mangle]
pub extern "C" fn octra_manifest(_ptr: i32, _len: i32) -> i32 {
    Host::respond_manifest_json(MANIFEST)
}

#[no_mangle]
pub extern "C" fn octra_query(ptr: i32, len: i32) -> i32 {
    run_query(ptr, len)
}

#[no_mangle]
pub extern "C" fn octra_update(ptr: i32, len: i32) -> i32 {
    run_update(ptr, len)
}
