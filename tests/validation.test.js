const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clpPrice } = require('../public/js/input-validation');

test('CLP accepts whole pesos and conventional Chilean grouping without losing precision', () => {
  for (const [input, expected] of [[1,1],[100000000,100000000],['1',1],['35000',35000],['35.000',35000],['$ 35.000',35000],['  $100.000.000  ',100000000]]) {
    assert.equal(clpPrice(input), expected, String(input));
  }
});

test('CLP rejects signs, fractions, malformed grouping and non-price types', () => {
  for (const input of [-1,'-1','$-1','−1','-35.000',0,'0',1.5,'1.5','1,5','35.00','1.0000','1e3','+1000','abc123','',null,undefined,true,false,[],[1],{},Infinity,NaN,100000001,'100.000.001']) {
    assert.ok(Number.isNaN(clpPrice(input)), JSON.stringify(input));
  }
});
