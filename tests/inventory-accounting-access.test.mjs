import test from 'node:test';
import assert from 'node:assert/strict';

test('inventory counts and configuration require authentication before reading any business data', async()=>{
  const { default: worker } = await import('../dist/server/index.js');
  let databaseAccesses=0;
  const env={ASSETS:{fetch:async()=>new Response('',{status:404})},DB:{prepare(){databaseAccesses++;throw new Error('Unauthenticated database access');}}};
  for(const action of [undefined,'configure','count','notify']){
    const request=new Request('http://localhost/api/inventory-accounting?branch=main',{method:action?'POST':'GET',headers:{'Content-Type':'application/json'},...(action?{body:JSON.stringify({action,inventoryId:'x',counts:[]})}:{})});
    const response=await worker.fetch(request,env,{waitUntil(){},passThroughOnException(){}});
    assert.equal(response.status,401);
  }
  assert.equal(databaseAccesses,0);
});
