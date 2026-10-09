#!/usr/bin/env node
/**
 * AutoApply Bridge CLI Client
 * Communicates with the local AutoApply Bridge HTTP/RPC endpoint on port 8765.
 */

const BRIDGE_URL = process.env.AUTOAPPLY_BRIDGE_URL || 'http://127.0.0.1:8765';

async function checkHealth() {
  try {
    const res = await fetch(`${BRIDGE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return await res.json();
  } catch (err) {
    return { error: `Cannot connect to AutoApply bridge at ${BRIDGE_URL}: ${err.message}` };
  }
}

async function callRpc(action, payload = {}, timeoutMs = 30000) {
  try {
    const res = await fetch(`${BRIDGE_URL}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload, timeoutMs }),
      signal: AbortSignal.timeout(timeoutMs + 5000),
    });
    const json = await res.json();
    return json;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function parseArgs(args) {
  const parsed = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        parsed[key] = next;
        i++;
      } else {
        parsed[key] = true;
      }
    } else {
      parsed._.push(arg);
    }
  }
  return parsed;
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const args = parseArgs(rawArgs);
  const cmd = args._[0] || 'status';

  switch (cmd) {
    case 'health': {
      const health = await checkHealth();
      console.log(JSON.stringify(health, null, 2));
      break;
    }

    case 'status': {
      const health = await checkHealth();
      if (health.error) {
        console.error(JSON.stringify(health, null, 2));
        process.exit(1);
      }
      const state = await callRpc('GET_STATE');
      console.log(JSON.stringify({ health, state: state.data || state }, null, 2));
      break;
    }

    case 'get-job':
    case 'job': {
      const res = await callRpc('GET_CURRENT_JOB');
      console.log(JSON.stringify(res.data || res, null, 2));
      break;
    }

    case 'get-profile':
    case 'profile': {
      const res = await callRpc('GET_PROFILE');
      console.log(JSON.stringify(res.data || res, null, 2));
      break;
    }

    case 'get-applied':
    case 'applied': {
      const limit = Number(args.limit) || 20;
      const res = await callRpc('GET_APPLIED_JOBS', { limit });
      console.log(JSON.stringify(res.data || res, null, 2));
      break;
    }

    case 'apply': {
      const mode = args.mode || 'semi-auto';
      const customPitch = args.pitch;
      const customCoverLetter = args.cover;
      const res = await callRpc('APPLY_CURRENT_JOB', {
        mode,
        customPitch,
        customCoverLetter,
      }, 60000);
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case 'approve': {
      const res = await callRpc('SUBMIT_PENDING_APPROVAL');
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case 'search': {
      const query = args.query || args._[1] || 'Software Engineer';
      const location = args.location || 'Remote';
      const platform = args.platform || 'linkedin';
      const mode = args.mode || 'semi-auto';
      const maxJobs = Number(args.max) || 5;
      const remoteOnly = args.remote !== 'false';
      const res = await callRpc('SEARCH_AND_APPLY', {
        query,
        location,
        platform,
        mode,
        maxJobs,
        remoteOnly,
      }, 120000);
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case 'navigate': {
      const url = args.url || args._[1];
      if (!url) {
        console.error('Error: missing URL');
        process.exit(1);
      }
      const newTab = !!args.newTab;
      const res = await callRpc('BROWSER_NAVIGATE', { url, newTab });
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case 'raw': {
      const action = args._[1];
      let payload = {};
      if (args._[2]) {
        try {
          payload = JSON.parse(args._[2]);
        } catch {
          payload = { text: args._[2] };
        }
      }
      const res = await callRpc(action, payload);
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    default:
      console.error(`Unknown command: ${cmd}`);
      console.error('Available commands: health, status, job, profile, applied, apply, approve, search, navigate, raw');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Bridge CLI Error:', err);
  process.exit(1);
});
