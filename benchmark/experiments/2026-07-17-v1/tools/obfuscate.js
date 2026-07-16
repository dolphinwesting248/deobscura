// Generate obfuscated versions of benchmark scenarios
// Each scenario uses different obfuscation techniques at increasing complexity

const JavaScriptObfuscator = require("javascript-obfuscator");
const fs = require("fs");
const path = require("path");

const scenarios = {
  A: {
    name: "API Client",
    difficulty: "easy",
    options: {
      compact: true,
      renameGlobals: true,
      renameProperties: false,
      stringArray: true,
      stringArrayEncoding: ["base64"],
      stringArrayThreshold: 0.5,
      rotateStringArray: true,
      selfDefending: false,
      deadCodeInjection: false,
      debugProtection: false,
      controlFlowFlattening: false,
      numbersToExpressions: false,
      simplify: true,
      splitStrings: false,
      transformObjectKeys: false,
      unicodeEscapeSequence: false,
    }
  },
  B: {
    name: "Auth Flow",
    difficulty: "medium",
    options: {
      compact: true,
      renameGlobals: true,
      renameProperties: false,
      stringArray: true,
      stringArrayEncoding: ["rc4"],
      stringArrayThreshold: 1,
      rotateStringArray: true,
      selfDefending: true,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 0.3,
      debugProtection: false,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.75,
      numbersToExpressions: true,
      simplify: true,
      splitStrings: true,
      splitStringsChunkLength: 5,
      transformObjectKeys: false,
      unicodeEscapeSequence: false,
    }
  },
  C: {
    name: "Data Pipeline",
    difficulty: "medium",
    options: {
      compact: true,
      renameGlobals: true,
      renameProperties: false,
      stringArray: true,
      stringArrayEncoding: ["base64"],
      stringArrayThreshold: 1,
      rotateStringArray: true,
      selfDefending: false,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 0.2,
      debugProtection: true,
      debugProtectionInterval: 4000,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.5,
      numbersToExpressions: true,
      simplify: true,
      splitStrings: true,
      splitStringsChunkLength: 8,
      transformObjectKeys: true,
      unicodeEscapeSequence: false,
    }
  },
  D: {
    name: "Webpack Bundle",
    difficulty: "hard",
    options: {
      compact: true,
      renameGlobals: true,
      renameProperties: false,
      stringArray: true,
      stringArrayEncoding: ["rc4"],
      stringArrayThreshold: 1,
      rotateStringArray: true,
      selfDefending: true,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 0.3,
      debugProtection: true,
      debugProtectionInterval: 4000,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.5,
      numbersToExpressions: true,
      simplify: true,
      splitStrings: true,
      splitStringsChunkLength: 4,
      transformObjectKeys: true,
      unicodeEscapeSequence: true,
    }
  },
  E: {
    name: "Payment Processing",
    difficulty: "hard",
    options: {
      compact: true,
      renameGlobals: true,
      renameProperties: true,
      stringArray: true,
      stringArrayEncoding: ["rc4"],
      stringArrayThreshold: 1,
      rotateStringArray: true,
      selfDefending: true,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 0.4,
      debugProtection: true,
      debugProtectionInterval: 4000,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.75,
      numbersToExpressions: true,
      simplify: true,
      splitStrings: true,
      splitStringsChunkLength: 3,
      transformObjectKeys: true,
      unicodeEscapeSequence: true,
      disableConsoleOutput: true,
      domainLock: [],
      reservedNames: [],
      seed: 0,
    }
  }
};

const basePath = path.join(__dirname, "scenarios");

for (const [key, config] of Object.entries(scenarios)) {
  const inputFile = path.join(basePath, key, "original.js");
  const outputFile = path.join(basePath, key, "obfuscated.js");

  if (!fs.existsSync(inputFile)) {
    console.log(`  SKIP ${key}: original.js not found`);
    continue;
  }

  const code = fs.readFileSync(inputFile, "utf-8");

  console.log(`Obfuscating ${key} (${config.name})...`);

  try {
    const result = JavaScriptObfuscator.obfuscate(code, {
      ...config.options,
      sourceMap: false,
      identifierNamesGenerator: "hexadecimal",
      identifiersDictionary: [],
      identifiersPrefix: "_0x",
      target: "browser",
      log: false,
    });

    const obfuscated = result.getObfuscatedCode();
    fs.writeFileSync(outputFile, obfuscated, "utf-8");
    const size = fs.statSync(outputFile).size;
    console.log(`  ${key}: ${(size / 1024).toFixed(1)} KB (${((size / code.length) * 100).toFixed(0)}% of original)`);
  } catch (e) {
    console.log(`  ${key}: ERROR - ${e.message.split("\n")[0]}`);
  }
}

console.log("\nDone!");
