/**
 * FIUU order id + vcode unit tests.
 * Run: node backend/tests/fiuuIntegration.test.js
 */
import assert from 'assert';
import {
  buildInvoiceOrderId,
  parseOrderId,
  formatFiuuDescription,
} from '../services/fiuu/orderId.js';
import { buildPaymentVcode, formatFiuuAmount } from '../services/fiuu/signature.js';
import { formatIpnAckBody } from '../services/fiuu/fiuuPaymentService.js';

process.env.FIUU_MERCHANT_ID = 'TESTMERCH';
process.env.FIUU_VERIFY_KEY = 'abc123verifykeyabc123verifykey12';
process.env.FIUU_SECRET_KEY = 'secret';

assert.strictEqual(formatFiuuAmount(3500), '3500.00');
const orderid = buildInvoiceOrderId(1842, 'A7F3');
assert.strictEqual(orderid, 'PSMS-I-1842-A7F3');
assert.deepStrictEqual(parseOrderId(orderid), {
  type: 'invoice',
  invoiceId: 1842,
  attempt: 'A7F3',
});

const vcode = buildPaymentVcode({ amount: '3500.00', orderid, currency: 'PHP' });
assert.strictEqual(typeof vcode, 'string');
assert.strictEqual(vcode.length, 32);

const desc = formatFiuuDescription({
  typeLabel: 'Invoice',
  studentName: 'Juan Dela Cruz',
  branchName: 'Somo',
  refLabel: 'INV-1842',
  amountPhp: 3500,
});
assert.ok(desc.includes('PSMS CMS'));
assert.ok(desc.includes('Juan Dela Cruz'));

const ipnAck = formatIpnAckBody({ orderid: 'DEMO894', status: '00' });
assert.ok(ipnAck.includes('treq=1'));
assert.ok(ipnAck.includes('orderid=DEMO894'));

console.log('fiuuIntegration.test.js: all passed');
