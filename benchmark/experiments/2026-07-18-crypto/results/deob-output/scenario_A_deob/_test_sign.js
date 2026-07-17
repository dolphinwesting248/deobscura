const code = require('fs').readFileSync(require('path').join(__dirname, 'main.js'), 'utf8');
const vm = require('vm');
const ctx = vm.createContext({ console, require, globalThis: {} });
vm.runInContext(code, ctx);
const signRequest = ctx.globalThis.signRequest;
const verifyRequest = ctx.globalThis.verifyRequest;

console.log('signRequest exists:', typeof signRequest);
console.log('verifyRequest exists:', typeof verifyRequest);

if (typeof signRequest === 'function') {
  const params = { user: 'test123', action: 'login', from: 'web' };
  const timestamp = '1700000000';
  const result = signRequest(params, timestamp);
  console.log('Signature:', result);
  const verify = verifyRequest(params, timestamp, result);
  console.log('Verification:', verify);
}
