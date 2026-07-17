const fs = require('fs');
const code = fs.readFileSync(__dirname + '/main.js', 'utf8');

// Override the infinite loop with a direct execution
// The module exports to globalThis
eval(code);

// Now signRequest should be on global
const r = signRequest({user:'test123',action:'login',from:'web'}, '1700000000');
fs.writeFileSync(__dirname + '/_result.txt', 'signature=' + r + '\n');
console.log('DONE:', r);
