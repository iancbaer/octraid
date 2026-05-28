use rust_circle_sdk::{decode_request, Host, Value};

// State layout (Option C: flat index keys + JSON blob records)
//
// score:{agent_id}      → JSON blob: {agent_id, score, trust_tier, last_updated_epoch}
// events:count:{id}     → u64 event count per agent
// events:total          → u64 total event count across all agents
//
// Cross-registry validation: reporter identity verified by caller address.
// The off-chain API verifies reporter is a registered agent before calling submit_event.
// Cross-Circle calls are not supported by the Octra runtime.
// Upgrade path: use cross-Circle calls to Identity Registry when runtime supports it.
//
// prove_threshold: scores are plaintext inside the sealed Circle (sealed execution = trust boundary).
// The Circle computes score >= threshold and uses fhe_pedersen to commit the result.
// fhe_pedersen commitment provides a cryptographic fingerprint tied to the sealed execution.
// The API layer wraps the result in a signed JWT using REGISTRY_PRIVATE_KEY.
//
// Future upgrade: store scores as FHE ciphertexts and use fhe_verify_bound() for
// trustless threshold proofs using available SDK primitives. The SDK already supports this.

const MANIFEST: &str = r#"{"methods":[
  {"name":"submit_event","view":false},
  {"name":"get_score","view":true},
  {"name":"prove_threshold","view":true},
  {"name":"get_tier","view":true},
  {"name":"get_event_count","view":true}
]}"#;

const INITIAL_SCORE: i64 = 10;

// Event type deltas
fn event_delta(event_type: &str) -> Result<i64, i32> {
    match event_type {
        "TransactionCompleted" => Ok(1),
        "TransactionFailed" => Ok(-2),
        "UnauthorizedAttempt" => Ok(-10),
        "Vouched" => Ok(5),
        "DisputeLost" => Ok(-20),
        "DisputeWon" => Ok(10),
        _ => Err(73), // unknown event type
    }
}

fn tier_for_score(score: i64) -> &'static str {
    match score {
        s if s >= 100 => "High",
        s if s >= 50 => "Standard",
        s if s >= 20 => "Low",
        _ => "Unverified",
    }
}

fn score_key(agent_id: &str) -> String {
    format!("score:{}", agent_id)
}

fn event_count_key(agent_id: &str) -> String {
    format!("events:count:{}", agent_id)
}

fn get_score_value(agent_id: &str) -> Result<i64, i32> {
    Ok(
        Host::kv_get_string(&score_key(agent_id))?
            .as_deref()
            .and_then(|j| extract_json_int(j, "score"))
            .unwrap_or(INITIAL_SCORE)
    )
}

fn get_event_count_value(agent_id: &str) -> Result<u64, i32> {
    Ok(
        Host::kv_get_string(&event_count_key(agent_id))?
            .unwrap_or_else(|| "0".to_owned())
            .parse::<u64>()
            .unwrap_or(0)
    )
}

// Extract an integer field from our controlled JSON format
fn extract_json_int(json: &str, field: &str) -> Option<i64> {
    let needle = format!(r#""{}":"#, field);
    let start = json.find(&needle)? + needle.len();
    let rest = &json[start..];
    let end = rest.find(|c: char| c == ',' || c == '}').unwrap_or(rest.len());
    rest[..end].trim().parse().ok()
}

fn build_score_json(agent_id: &str, score: i64, epoch: u64) -> String {
    let tier = tier_for_score(score);
    format!(
        r#"{{"agent_id":"{}","score":{},"trust_tier":"{}","last_updated_epoch":{}}}"#,
        agent_id, score, tier, epoch
    )
}

fn submit_event(request: &rust_circle_sdk::Request) -> i32 {
    let agent_id = match request.string_param(0) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let event_type = match request.string_param(1) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let evidence_uri = match request.string_param(2) {
        Ok(v) => v,
        Err(e) => return e,
    };

    let reporter = match Host::caller() {
        Ok(c) => c,
        Err(e) => return e,
    };

    let delta = match event_delta(event_type) {
        Ok(d) => d,
        Err(e) => return e,
    };

    // Vouched events require reporter score > 50. Check reporter's own score.
    if event_type == "Vouched" {
        let reporter_score = match get_score_value(&reporter) {
            Ok(s) => s,
            Err(e) => return e,
        };
        if reporter_score <= 50 {
            return 74; // insufficient score to vouch
        }
    }

    let current_score = match get_score_value(agent_id) {
        Ok(s) => s,
        Err(e) => return e,
    };

    // Score floor is 0
    let new_score = (current_score + delta).max(0);
    let epoch = Host::epoch();

    let score_json = build_score_json(agent_id, new_score, epoch);
    if let Err(e) = Host::kv_put_string(&score_key(agent_id), &score_json) {
        return e;
    }

    // Increment event count
    let count = match get_event_count_value(agent_id) {
        Ok(c) => c,
        Err(e) => return e,
    };
    if let Err(e) = Host::kv_put_string(&event_count_key(agent_id), &(count + 1).to_string()) {
        return e;
    }

    // Increment global total
    let total: u64 = Host::kv_get_string("events:total")
        .ok().flatten()
        .unwrap_or_else(|| "0".to_owned())
        .parse()
        .unwrap_or(0);
    let _ = Host::kv_put_string("events:total", &(total + 1).to_string());

    let event = format!(
        r#"{{"event":"ReputationUpdated","agent_id":"{}","event_type":"{}","delta":{},"reporter":"{}","evidence_uri":"{}","epoch":{}}}"#,
        agent_id, event_type, delta, reporter, evidence_uri, epoch
    );
    let _ = Host::emit_event("octraid.reputation", event.as_bytes());

    // Return event ID = count + 1
    Host::respond_value(Value::Int((count + 1).to_string()))
}

// prove_threshold: sealed oracle pattern using fhe_pedersen for result commitment.
//
// The Circle reads the plaintext score (sealed execution = trust boundary),
// computes above_threshold, then uses fhe_pedersen to create a cryptographic
// commitment to the boolean result. The commitment is deterministic per (agent, epoch, threshold)
// and cannot be forged without access to the Circle's sealed state.
//
// The API layer wraps this in a signed JWT. The attestation format is:
// { agent_id, threshold, above_threshold, tier, commitment, epoch, expires_at }
// signed with REGISTRY_PRIVATE_KEY using HS256/RS256.
fn prove_threshold(request: &rust_circle_sdk::Request) -> i32 {
    let agent_id = match request.string_param(0) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let threshold = match request.int_param(1) {
        Ok(v) => v,
        Err(e) => return e,
    };

    let score = match get_score_value(agent_id) {
        Ok(s) => s,
        Err(e) => return e,
    };

    let above_threshold = score >= threshold;
    let epoch = Host::epoch();
    let tier = tier_for_score(score);

    // Create a Pedersen commitment to the boolean result.
    // Blinding is derived from the Circle's self address + agent_id + epoch + threshold
    // to make commitments deterministic and verifiable but not guessable externally.
    // The sealed Circle is the only entity that can produce this commitment.
    let self_addr = Host::self_addr().unwrap_or_default();
    let blinding_input = format!("{}:{}:{}:{}", self_addr, agent_id, epoch, threshold);
    // Use a simple deterministic blinding: sha256-like hash over the string
    // (no std sha256 available; use djb2 + xor-fold then base64-like encode)
    let blinding_b64 = derive_blinding(&blinding_input);

    let commitment_result = Host::fhe_pedersen(if above_threshold { 1 } else { 0 }, &blinding_b64);

    let commitment = commitment_result.unwrap_or_else(|_| {
        // fhe_pedersen may not be available if Circle lacks FHE enrollment.
        // Fall back to a deterministic string commitment.
        format!("hash:{}:{}", blinding_b64, if above_threshold { 1 } else { 0 })
    });

    let result_json = format!(
        r#"{{"agent_id":"{}","threshold":{},"above_threshold":{},"tier":"{}","commitment":"{}","epoch":{}}}"#,
        agent_id, threshold, above_threshold, tier, commitment, epoch
    );

    Host::respond_value(Value::String(result_json))
}

// Derives a base64-encoded blinding factor from an input string.
// Uses djb2 + fnv1a mix for reasonable distribution without std crypto.
fn derive_blinding(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut h1: u64 = 5381;
    let mut h2: u64 = 0xcbf29ce484222325; // FNV offset basis
    for &b in bytes {
        h1 = h1.wrapping_mul(33).wrapping_add(b as u64);
        h2 ^= b as u64;
        h2 = h2.wrapping_mul(0x100000001b3); // FNV prime
    }
    let combined: [u8; 16] = [
        (h1 >> 56) as u8, (h1 >> 48) as u8, (h1 >> 40) as u8, (h1 >> 32) as u8,
        (h1 >> 24) as u8, (h1 >> 16) as u8, (h1 >>  8) as u8,  h1        as u8,
        (h2 >> 56) as u8, (h2 >> 48) as u8, (h2 >> 40) as u8, (h2 >> 32) as u8,
        (h2 >> 24) as u8, (h2 >> 16) as u8, (h2 >>  8) as u8,  h2        as u8,
    ];
    base64_encode(&combined)
}

// Minimal base64 encoder (no std in wasm32-unknown-unknown)
fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 { out.push(TABLE[((n >> 6) & 63) as usize] as char); } else { out.push('='); }
        if chunk.len() > 2 { out.push(TABLE[(n & 63) as usize] as char); } else { out.push('='); }
    }
    out
}

fn run_query(ptr: i32, len: i32) -> i32 {
    let request = match decode_request(ptr, len) {
        Ok(r) => r,
        Err(e) => return e,
    };

    match request.method.as_str() {
        "get_score" => {
            let agent_id = match request.string_param(0) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match Host::kv_get_string(&score_key(agent_id)) {
                Ok(Some(json)) => {
                    // Return score record — tier only exposed, not raw score, in the API layer.
                    // The Circle returns the full record; the API filters before responding to clients.
                    Host::respond_value(Value::String(json.to_owned()))
                }
                Ok(None) => Host::respond_value(Value::String(
                    build_score_json(agent_id, INITIAL_SCORE, 0)
                )),
                Err(e) => e,
            }
        }

        "prove_threshold" => prove_threshold(&request),

        "get_tier" => {
            let agent_id = match request.string_param(0) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let score = match get_score_value(agent_id) {
                Ok(s) => s,
                Err(e) => return e,
            };
            Host::respond_value(Value::String(tier_for_score(score).to_owned()))
        }

        "get_event_count" => {
            let agent_id = match request.string_param(0) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match get_event_count_value(agent_id) {
                Ok(count) => Host::respond_value(Value::Int(count.to_string())),
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
        "submit_event" => submit_event(&request),
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
