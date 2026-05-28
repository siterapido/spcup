#!/usr/bin/env node
/** Atalho dev na raiz do monorepo → launcher empacotado */
const path = require("node:path");
process.env.SPCUP_MONOREPO_ROOT = path.resolve(__dirname, "..");
require(path.join(__dirname, "../apps/cli/dist/launcher.js"));
