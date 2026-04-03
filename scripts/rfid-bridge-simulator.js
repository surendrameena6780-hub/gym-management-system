const readline = require('node:readline');

if (typeof fetch !== 'function') {
  console.error('This simulator requires a Node.js version with global fetch support.');
  process.exit(1);
}

const USAGE = [
  'Usage:',
  '  node scripts/rfid-bridge-simulator.js --api http://localhost:5000 --serial GATE-01 --key your_shared_key --tag 123456789',
  '  npm run rfid:simulate -- --api http://localhost:5000 --serial GATE-01 --key your_shared_key',
  '',
  'Environment variables also work:',
  '  RFID_API_BASE_URL, RFID_READER_SERIAL, RFID_READER_KEY, RFID_TAG_ID, RFID_NOTES',
].join('\n');

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = nextValue;
    index += 1;
  }
  return args;
};

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

const apiBaseUrl = String(args.api || process.env.RFID_API_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
const readerSerial = String(args.serial || process.env.RFID_READER_SERIAL || '').trim();
const readerKey = String(args.key || process.env.RFID_READER_KEY || '').trim();
const defaultTag = String(args.tag || process.env.RFID_TAG_ID || '').trim();
const defaultNotes = String(args.notes || process.env.RFID_NOTES || 'RFID bridge simulator').trim();

if (!readerSerial || !readerKey) {
  console.error('Reader serial and key are required.');
  console.error(USAGE);
  process.exit(1);
}

const sendTag = async (tagId) => {
  const cleanTag = String(tagId || '').trim();
  if (!cleanTag) return false;

  const response = await fetch(`${apiBaseUrl}/api/attendance/rfid/event`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-reader-key': readerKey,
    },
    body: JSON.stringify({
      reader_serial: readerSerial,
      tag_id: cleanTag,
      notes: defaultNotes,
      scanned_at: new Date().toISOString(),
    }),
  });

  let body = {};
  try {
    body = await response.json();
  } catch (_err) {
    body = {};
  }

  if (response.ok) {
    console.log(`ALLOW  ${cleanTag}  ${body.member?.full_name || 'Member'}  ${body.message || ''}`.trim());
  } else {
    console.log(`DENY   ${cleanTag}  ${body.message || body.error || 'Rejected'}`.trim());
  }

  console.log(JSON.stringify(body, null, 2));
  return response.ok;
};

const runInteractive = async () => {
  console.log(`RFID simulator ready for ${readerSerial}.`);
  console.log('Enter a tag id and press Enter. Submit an empty line to exit.');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = () => {
    rl.question('tag_id> ', async (answer) => {
      const value = String(answer || '').trim();
      if (!value) {
        rl.close();
        return;
      }

      try {
        await sendTag(value);
      } catch (err) {
        console.error(`Request failed: ${err.message}`);
      }

      ask();
    });
  };

  ask();
};

(async () => {
  try {
    if (defaultTag) {
      const ok = await sendTag(defaultTag);
      process.exit(ok ? 0 : 1);
      return;
    }

    await runInteractive();
  } catch (err) {
    console.error(`RFID simulator failed: ${err.message}`);
    process.exit(1);
  }
})();