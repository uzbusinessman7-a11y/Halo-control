import test from 'node:test';
import assert from 'node:assert/strict';

test('anonymous users cannot read or mutate terminal financial records', async () => {
  const { default: worker } = await import('../dist/server/index.js');
  let databaseAccesses=0;
  const env={ ASSETS: { fetch: async()=>new Response('',{status:404}) },
    DB: { prepare() { databaseAccesses++; throw new Error('Anonymous request reached database'); } } };
  for(const method of ['GET','POST','PUT','DELETE','PATCH']) {
    const request=new Request('http://localhost/api/pos-terminal?branch=main',{
      method,headers:{'Content-Type':'application/json'},...(method==='GET'?{}:{body:'{}'})
    });
    const response=await worker.fetch(request,env,{waitUntil(){},passThroughOnException(){}});
    assert.equal(response.status,401,`${method} must require an authenticated owner or worker`);
  }
  assert.equal(databaseAccesses,0,'no business data may be read before authentication');
});
