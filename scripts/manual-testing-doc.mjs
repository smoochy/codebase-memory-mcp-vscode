#!/usr/bin/env node
// Write docs/MANUAL-TESTING.md from the registry and the template.
//
// `npm run docs:rows` after changing either. The drift check in
// scripts/check-rows.mjs is what stops the committed file from disagreeing.

import { writeFileSync } from 'node:fs'

import { docPath, renderDoc } from './manual-testing-rows.mjs'

writeFileSync(docPath, renderDoc())
console.log(`wrote ${docPath}`)
