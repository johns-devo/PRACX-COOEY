import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const moduleUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64');
const paymentUrl = moduleUrl(await readFile(new URL('../lib/payment-posting.ts', import.meta.url), 'utf8'));
const parserSource = (await readFile(new URL('../lib/era-835.ts', import.meta.url), 'utf8')).replace('"./payment-posting"', JSON.stringify(paymentUrl));
const { parseEra835, adjustmentDescription } = await import(moduleUrl(parserSource));

test('PR2 is coinsurance, not a write-off; CLP total is not added twice', () => {
  const parsed = parseEra835('BPR*I*60~TRN*1*T1~CLP*C1*1*100*60*20~SVC*HC:99213*100*60~DTM*472*20260914~CAS*CO*45*20~CAS*PR*2*20~');
  const claim = parsed.claims[0];
  assert.equal(claim.patientResponsibility, '20.00');
  assert.equal(claim.adjustmentAmount, '20.00');
  assert.equal(claim.allowedAmount, '80.00');
  assert.equal(claim.serviceLines[0].patientResponsibility, '20.00');
  assert.equal(claim.serviceLines[0].adjustmentAmount, '20.00');
  assert.equal(claim.serviceLines[0].serviceDate, '2026-09-14');
  assert.deepEqual(claim.serviceLines[0].adjustments[1], { group: 'PR', code: '2', amount: '20.00' });
  assert.match(adjustmentDescription('PR2'), /coinsurance/);
});
test('claim-level PR stays claim-level and missing CLP05 derives from CAS', () => {
  const claim = parseEra835('BPR*I*80~TRN*1*T2~CLP*C2*1*100*80*~CAS*PR*1*10**2*5**3*5~SVC*HC:99213*100*80~').claims[0];
  assert.equal(claim.patientResponsibility, '20.00');
  assert.equal(claim.adjustments.length, 3);
  assert.equal(claim.serviceLines[0].patientResponsibility, '0.00');
});
test('explicit zero check is not replaced by claim payments', () => {
  assert.equal(parseEra835('BPR*I*0~TRN*1*T3~CLP*C3*1*100*80*20~').paymentAmount, '0.00');
});
test('multiple CPT PR amounts aggregate once', () => {
  const claim = parseEra835('BPR*I*80~TRN*1*T4~CLP*C4*1*100*80*20~SVC*HC:99213*50*40~CAS*PR*2*10~SVC*HC:99214*50*40~CAS*PR*3*10~').claims[0];
  assert.equal(claim.patientResponsibility, '20.00');
  assert.equal(claim.serviceLines.reduce((sum, line) => sum + Number(line.patientResponsibility), 0), 20);
});
