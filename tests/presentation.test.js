const { test } = require('node:test');
const assert = require('node:assert/strict');
const view = require('../public/js/booking-view');
const { contactProfile } = require('../server/profile-validation');

test('Profile validates contact fields and normalizes valid optional values', () => {
  assert.deepEqual(contactProfile({}), {phone:'',rut:'',address:''});
  assert.deepEqual(contactProfile({phone:'+56 9 1234 5678',rut:'12.345.678-5',address:' Oficina '}),
    {phone:'+56912345678',rut:'12345678-5',address:'Oficina'});
  for (const body of [{phone:'abc'}, {phone:'123'}, {phone:'1'.repeat(16)}, {rut:'abc'}, {rut:'12345678-9'}, {rut:'00000000-0'}, {phone:123}]) {
    assert.throws(() => contactProfile(body));
  }
});
test('Dashboard separates future reservations, pending liquidation and refunded customer spend', () => {
  const rows = [
    {status:'pagado',startAt:101,paidAt:1,amount:35000,professionalNet:29750},
    {status:'pagado',startAt:99,paidAt:1,amount:35000,professionalNet:29750},
    {status:'completado',startAt:1,paidAt:1,amount:35000,professionalNet:29750},
    {status:'cancelado',startAt:101,paidAt:1,amount:35000,refundAmount:28000,professionalNet:29750},
    {status:'aceptado',startAt:100}, {status:'aceptado',startAt:102}, {status:'solicitado'}
  ];
  assert.deepEqual(view.metrics(rows,100), {pending:1,upcoming:2,pendingNet:59500,paidNet:112000,completed:1});
  assert.deepEqual(rows.filter(view.isTerminal).map(b=>b.status), ['completado','cancelado']);
  assert.equal(view.metrics([{status:'pagado',paidAt:1,professionalNet:10,cancellationStatus:'revision'}]).pendingNet,0);
});
test('Cancelled booking never presents original professional net as payable', () => {
  const lines=view.financialLines({status:'cancelado',refundAmount:28000,retainedAmount:7000,professionalNet:29750});
  assert.deepEqual(lines.map(line=>line[1]), [28000,7000]);
  assert.match(lines[1][0],/no liquidada/);
  assert.equal(view.paymentLabel('pagado'),'Pago confirmado');
  assert.ok(!view.paymentLabel('pagado').includes('servicio en curso'));
});
