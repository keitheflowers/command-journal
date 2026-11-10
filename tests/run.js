#!/usr/bin/env node
// Runs every tests/*.test.js file. Usage: node tests/run.js [filter]
const fs = require('fs'), path = require('path');
const { setup, teardown } = require('./harness');

(async () => {
  const filter = process.argv[2] || '';
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
  await setup();
  let pass = 0, fail = 0;
  const failures = [];
  const t0 = Date.now();
  for (const f of files) {
    const tests = require(path.join(__dirname, f));
    for (const [name, fn] of Object.entries(tests)) {
      const label = `${f.replace('.test.js', '')} › ${name}`;
      if (filter && !label.toLowerCase().includes(filter.toLowerCase())) continue;
      const s = Date.now();
      try {
        await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 60s')), 60000))]);
        pass++; console.log(`  ✓ ${label} (${Date.now() - s} ms)`);
      } catch (e) {
        fail++; failures.push(label); console.log(`  ✗ ${label}\n      ${String(e.message || e).split('\n').join('\n      ')}`);
      }
    }
  }
  await teardown();
  console.log(`\n${pass} passed, ${fail} failed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (fail) { console.log('Failed:\n  ' + failures.join('\n  ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
