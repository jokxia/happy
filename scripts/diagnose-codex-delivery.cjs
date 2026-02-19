#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const happyHome = process.env.HAPPY_HOME_DIR || path.join(os.homedir(), '.happy');
const accessKeyPath = path.join(happyHome, 'access.key');
const logsDir = path.join(happyHome, 'logs');
const serverUrl = process.env.HAPPY_SERVER_URL || 'https://api.cluster-fluster.com';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function grepCount(content, pattern) {
  const match = content.match(pattern);
  return match ? match.length : 0;
}

function collectLogEvidence(sessionId) {
  if (!fs.existsSync(logsDir)) {
    return {
      files: 0,
      codexConnected: 0,
      queuePush: 0,
      socketUpdates: 0,
      appSentHints: 0,
      startedBy: 'unknown',
    };
  }

  const files = fs.readdirSync(logsDir).filter((name) => name.endsWith('.log'));
  let codexConnected = 0;
  let queuePush = 0;
  let socketUpdates = 0;
  let appSentHints = 0;
  let startedBy = 'unknown';
  let matchedFiles = 0;

  for (const fileName of files) {
    const filePath = path.join(logsDir, fileName);
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    if (!content.includes(sessionId)) {
      continue;
    }
    matchedFiles++;

    codexConnected += grepCount(content, /\[CodexMCP\] Connected to Codex/g);
    queuePush += grepCount(content, /\[MessageQueue2\] push\(\) called/g);
    socketUpdates += grepCount(content, /\[SOCKET\] \[UPDATE\] Received update/g);
    appSentHints += grepCount(content, /"sentFrom": "(android|ios|web|mac)"/g);

    const startedByMatch = content.match(new RegExp(`Session webhook: ${sessionId}, PID: \\d+, started by: ([^\\s]+)`));
    if (startedByMatch && startedByMatch[1]) {
      startedBy = startedByMatch[1];
    }
  }

  return {
    files: matchedFiles,
    codexConnected,
    queuePush,
    socketUpdates,
    appSentHints,
    startedBy,
  };
}

async function apiGetJson(token, url) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} ${url}\n${body.slice(0, 200)}`);
  }
  return response.json();
}

function classifyResult(session, messageCount, evidence) {
  if (!session) {
    return 'session_not_found';
  }
  if ((session.seq || 0) === 0 && messageCount === 0) {
    return 'no_message_written_to_session';
  }
  if (session.seq > 0 && evidence.queuePush === 0) {
    return 'messages_written_but_not_processed_in_this_log_window';
  }
  if (session.seq > 0 && evidence.queuePush > 0) {
    return 'message_pipeline_healthy';
  }
  return 'needs_manual_review';
}

async function main() {
  const sessionIds = process.argv.slice(2);
  if (sessionIds.length === 0) {
    console.error('Usage: node scripts/diagnose-codex-delivery.cjs <sessionId> [sessionId...]');
    process.exit(1);
  }

  if (!fs.existsSync(accessKeyPath)) {
    console.error(`access.key not found: ${accessKeyPath}`);
    process.exit(1);
  }

  const access = readJson(accessKeyPath);
  const token = access && access.token;
  if (!token) {
    console.error(`No token in ${accessKeyPath}`);
    process.exit(1);
  }

  const sessionsResp = await apiGetJson(token, `${serverUrl}/v1/sessions`);
  const sessionsById = new Map((sessionsResp.sessions || []).map((s) => [s.id, s]));

  console.log(`Server: ${serverUrl}`);
  console.log(`Happy home: ${happyHome}`);
  console.log('---');

  for (const sessionId of sessionIds) {
    const session = sessionsById.get(sessionId) || null;
    let messageCount = 0;
    let hasMore = false;
    try {
      const messagesResp = await apiGetJson(
        token,
        `${serverUrl}/v3/sessions/${encodeURIComponent(sessionId)}/messages?after_seq=0&limit=500`
      );
      messageCount = Array.isArray(messagesResp.messages) ? messagesResp.messages.length : 0;
      hasMore = !!messagesResp.hasMore;
    } catch (error) {
      console.log(`Session ${sessionId}`);
      console.log(`  error_fetching_messages: ${String(error.message || error)}`);
      console.log('---');
      continue;
    }

    const evidence = collectLogEvidence(sessionId);
    const diagnosis = classifyResult(session, messageCount, evidence);

    console.log(`Session ${sessionId}`);
    console.log(`  server_seq: ${session ? session.seq : 'N/A'}`);
    console.log(`  server_active: ${session ? session.active : 'N/A'}`);
    console.log(`  server_updated_at: ${session ? new Date(session.updatedAt).toISOString() : 'N/A'}`);
    console.log(`  v3_message_count(limit500): ${messageCount}`);
    console.log(`  v3_has_more: ${hasMore}`);
    console.log(`  log_started_by: ${evidence.startedBy}`);
    console.log(`  log_files_with_session: ${evidence.files}`);
    console.log(`  log_codex_connected: ${evidence.codexConnected}`);
    console.log(`  log_queue_push: ${evidence.queuePush}`);
    console.log(`  log_socket_updates: ${evidence.socketUpdates}`);
    console.log(`  log_app_sent_hints: ${evidence.appSentHints}`);
    console.log(`  diagnosis: ${diagnosis}`);
    console.log('---');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
