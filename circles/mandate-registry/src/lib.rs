use rust_circle_sdk::{decode_request, Host, Value};

// State layout (Option C: flat index keys + JSON blob records)
//
// mandate:{id}             → JSON blob of Mandate record
// agent:{agent_id}:mandates → comma-delimited list of mandate IDs
// principal:{addr}:mandates → comma-delimited list of mandate IDs
// mandates:total            → u64 total mandate count
//
// Mandate IDs: "mnd_" + djb2/fnv hash of (agent_id + scope_hash + valid_from epoch)
//
// Privacy: scope_hash is the keccak256 (or sha256) of the actual scope JSON.
// The scope contents are never stored on-chain. verify_mandate reveals authorization
// without revealing what was authorized.
//
// Cross-registry validation: the off-chain API verifies the caller is the agent's principal
// before calling issue(). The Circle only checks that the caller matches principal_address
// stored in the mandate. Agent-principal binding is verified off-chain.

const MANIFEST: &str = r#"{"methods":[
  {"name":"issue","view":false},
  {"name":"revoke","view":false},
  {"name":"record_spend","view":false},
  {"name":"verify_mandate","view":true},
  {"name":"get_active_mandate_count","view":true}
]}"#;

fn mandate_key(mandate_id: &str) -> String {
    format!("mandate:{}", mandate_id)
}

fn agent_mandates_key(agent_id: &str) -> String {
    format!("agent:{}:mandates", agent_id)
}

fn principal_mandates_key(principal_addr: &str) -> String {
    format!("principal:{}:mandates", principal_addr)
}

fn derive_mandate_id(agent_id: &str, scope_hash: &str, epoch: u64) -> String {
    let input = format!("{}:{}:{}", agent_id, scope_hash, epoch);
    let bytes = input.as_bytes();
    let mut h1: u64 = 5381;
    let mut h2: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        h1 = h1.wrapping_mul(33).wrapping_add(b as u64);
        h2 ^= b as u64;
        h2 = h2.wrapping_mul(0x100000001b3);
    }
    format!("mnd_{:08x}{:08x}", (h1 & 0xffffffff), (h2 & 0xffffffff))
}

fn append_to_list(key: &str, value: &str) -> Result<(), i32> {
    let current = Host::kv_get_string(key)?.unwrap_or_default();
    let updated = if current.is_empty() {
        value.to_owned()
    } else {
        format!("{},{}", current, value)
    };
    Host::kv_put_string(key, &updated)
}

fn get_mandate_json(mandate_id: &str) -> Result<Option<String>, i32> {
    Host::kv_get_string(&mandate_key(mandate_id))
}

fn extract_json_str<'a>(json: &'a str, field: &str) -> Option<&'a str> {
    let needle = format!(r#""{}":""#, field);
    let start = json.find(&needle)? + needle.len();
    let end = json[start..].find('"')? + start;
    Some(&json[start..end])
}

fn extract_json_int(json: &str, field: &str) -> Option<i64> {
    let needle = format!(r#""{}":"#, field);
    let start = json.find(&needle)? + needle.len();
    let rest = &json[start..];
    let end = rest.find(|c: char| c == ',' || c == '}').unwrap_or(rest.len());
    rest[..end].trim().trim_matches('"').parse().ok()
}

fn replace_field(json: &str, field: &str, new_value: &str) -> String {
    let needle = format!(r#""{}":"#, field);
    if let Some(start) = json.find(&needle) {
        let after = start + needle.len();
        // Find end of value (handles both quoted and unquoted)
        let (_val_start, val_end, quoted) = if json[after..].starts_with('"') {
            let vs = after + 1;
            let ve = json[vs..].find('"').map(|i| vs + i).unwrap_or(json.len());
            (after, ve + 1, true)
        } else {
            let ve = json[after..].find(|c: char| c == ',' || c == '}').map(|i| after + i).unwrap_or(json.len());
            (after, ve, false)
        };
        let mut result = json[..after].to_owned();
        if quoted {
            result.push('"');
            result.push_str(new_value);
            result.push('"');
        } else {
            result.push_str(new_value);
        }
        result.push_str(&json[val_end..]);
        return result;
    }
    json.to_owned()
}

fn issue(request: &rust_circle_sdk::Request) -> i32 {
    let agent_id = match request.string_param(0) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let principal_address = match request.string_param(1) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let scope_hash = match request.string_param(2) {
        Ok(v) => v,
        Err(e) => return e,
    };
    // max_value: 0 means no per-tx limit
    let max_value = match request.int_param(3) {
        Ok(v) => v,
        Err(e) => return e,
    };
    // total_budget: 0 means no budget limit
    let total_budget = match request.int_param(4) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let valid_from = match request.int_param(5) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let valid_until = match request.int_param(6) {
        Ok(v) => v,
        Err(e) => return e,
    };

    let caller = match Host::caller() {
        Ok(c) => c,
        Err(e) => return e,
    };
    if caller != principal_address {
        return 70; // caller must be principal
    }

    let epoch = Host::epoch() as i64;
    let mandate_id = derive_mandate_id(agent_id, scope_hash, epoch as u64);

    let max_value_str = if max_value > 0 { max_value.to_string() } else { "null".to_owned() };
    let total_budget_str = if total_budget > 0 { total_budget.to_string() } else { "null".to_owned() };

    let record = format!(
        r#"{{"mandate_id":"{}","agent_id":"{}","principal_address":"{}","scope_hash":"{}","max_value":{},"total_budget":{},"spent":0,"valid_from":{},"valid_until":{},"status":"Active"}}"#,
        mandate_id, agent_id, principal_address, scope_hash,
        max_value_str, total_budget_str,
        valid_from, valid_until
    );

    if let Err(e) = Host::kv_put_string(&mandate_key(&mandate_id), &record) {
        return e;
    }
    if let Err(e) = append_to_list(&agent_mandates_key(agent_id), &mandate_id) {
        return e;
    }
    if let Err(e) = append_to_list(&principal_mandates_key(principal_address), &mandate_id) {
        return e;
    }

    let total: u64 = Host::kv_get_string("mandates:total")
        .ok().flatten()
        .unwrap_or_else(|| "0".to_owned())
        .parse().unwrap_or(0);
    let _ = Host::kv_put_string("mandates:total", &(total + 1).to_string());

    let event = format!(
        r#"{{"event":"MandateIssued","mandate_id":"{}","agent_id":"{}","principal":"{}","epoch":{}}}"#,
        mandate_id, agent_id, principal_address, epoch
    );
    let _ = Host::emit_event("octraid.mandate", event.as_bytes());

    Host::respond_value(Value::String(mandate_id.to_owned()))
}

fn revoke(request: &rust_circle_sdk::Request) -> i32 {
    let mandate_id = match request.string_param(0) {
        Ok(v) => v,
        Err(e) => return e,
    };

    let caller = match Host::caller() {
        Ok(c) => c,
        Err(e) => return e,
    };

    let json = match get_mandate_json(mandate_id) {
        Ok(Some(j)) => j,
        Ok(None) => return 72,
        Err(e) => return e,
    };

    if !json.contains(&format!(r#""principal_address":"{}""#, caller)) {
        return 70;
    }

    let updated = replace_field(&json, "status", "Revoked");
    if let Err(e) = Host::kv_put_string(&mandate_key(mandate_id), &updated) {
        return e;
    }

    let event = format!(
        r#"{{"event":"MandateRevoked","mandate_id":"{}","epoch":{}}}"#,
        mandate_id, Host::epoch()
    );
    let _ = Host::emit_event("octraid.mandate", event.as_bytes());

    Host::respond_value(Value::Bool(true))
}

fn record_spend(request: &rust_circle_sdk::Request) -> i32 {
    let mandate_id = match request.string_param(0) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let amount = match request.int_param(1) {
        Ok(v) => v,
        Err(e) => return e,
    };

    let caller = match Host::caller() {
        Ok(c) => c,
        Err(e) => return e,
    };

    let json = match get_mandate_json(mandate_id) {
        Ok(Some(j)) => j,
        Ok(None) => return 72,
        Err(e) => return e,
    };

    // Only the agent holding the mandate can record spend
    let agent_id = match extract_json_str(&json, "agent_id") {
        Some(a) => a.to_owned(),
        None => return 75,
    };
    if caller != agent_id {
        return 70;
    }

    // Mandate must be Active
    if !json.contains(r#""status":"Active""#) {
        return 76; // mandate not active
    }

    let spent = extract_json_int(&json, "spent").unwrap_or(0);
    let new_spent = spent + amount;

    let total_budget = extract_json_int(&json, "total_budget");
    let new_status = if let Some(budget) = total_budget {
        if new_spent >= budget { "Exhausted" } else { "Active" }
    } else {
        "Active"
    };

    let updated = replace_field(
        &replace_field(&json, "spent", &new_spent.to_string()),
        "status",
        new_status,
    );

    if let Err(e) = Host::kv_put_string(&mandate_key(mandate_id), &updated) {
        return e;
    }

    Host::respond_value(Value::Bool(true))
}

// verify_mandate: proves authorization without revealing scope contents.
// Given agent_id and scope_hash, returns whether there is a valid Active mandate
// covering that scope. The scope contents stay off-chain; only the hash is stored.
fn verify_mandate(request: &rust_circle_sdk::Request) -> i32 {
    let agent_id = match request.string_param(0) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let scope_hash = match request.string_param(1) {
        Ok(v) => v,
        Err(e) => return e,
    };

    let epoch = Host::epoch() as i64;

    let mandate_list = match Host::kv_get_string(&agent_mandates_key(agent_id)) {
        Ok(Some(l)) => l,
        Ok(None) => {
            return Host::respond_value(Value::String(
                format!(r#"{{"valid":false,"mandate_id":null,"expires_at":null,"remaining_budget":null}}"#)
            ));
        }
        Err(e) => return e,
    };

    // Scan agent's mandates for a matching Active one
    for mid in mandate_list.split(',') {
        let mid = mid.trim();
        if mid.is_empty() { continue; }
        let json = match Host::kv_get_string(&mandate_key(mid)) {
            Ok(Some(j)) => j,
            _ => continue,
        };

        if !json.contains(&format!(r#""scope_hash":"{}""#, scope_hash)) { continue; }
        if !json.contains(r#""status":"Active""#) { continue; }

        let valid_from = extract_json_int(&json, "valid_from").unwrap_or(0);
        let valid_until = extract_json_int(&json, "valid_until").unwrap_or(i64::MAX);

        if epoch < valid_from || epoch > valid_until { continue; }

        let spent = extract_json_int(&json, "spent").unwrap_or(0);
        let remaining = extract_json_int(&json, "total_budget").map(|b| b - spent);

        let remaining_str = remaining.map(|r| r.to_string()).unwrap_or_else(|| "null".to_owned());

        let result = format!(
            r#"{{"valid":true,"mandate_id":"{}","expires_at":{},"remaining_budget":{}}}"#,
            mid, valid_until, remaining_str
        );
        return Host::respond_value(Value::String(result));
    }

    Host::respond_value(Value::String(
        r#"{"valid":false,"mandate_id":null,"expires_at":null,"remaining_budget":null}"#.to_owned()
    ))
}

fn run_query(ptr: i32, len: i32) -> i32 {
    let request = match decode_request(ptr, len) {
        Ok(r) => r,
        Err(e) => return e,
    };

    match request.method.as_str() {
        "verify_mandate" => verify_mandate(&request),

        "get_active_mandate_count" => {
            let agent_id = match request.string_param(0) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let epoch = Host::epoch() as i64;
            let mandate_list = match Host::kv_get_string(&agent_mandates_key(agent_id)) {
                Ok(Some(l)) => l,
                Ok(None) => return Host::respond_value(Value::Int("0".to_owned())),
                Err(e) => return e,
            };
            let mut count: u64 = 0;
            for mid in mandate_list.split(',') {
                let mid = mid.trim();
                if mid.is_empty() { continue; }
                if let Ok(Some(json)) = Host::kv_get_string(&mandate_key(mid)) {
                    if !json.contains(r#""status":"Active""#) { continue; }
                    let valid_until = extract_json_int(&json, "valid_until").unwrap_or(i64::MAX);
                    if epoch <= valid_until { count += 1; }
                }
            }
            Host::respond_value(Value::Int(count.to_string()))
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
        "issue" => issue(&request),
        "revoke" => revoke(&request),
        "record_spend" => record_spend(&request),
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
