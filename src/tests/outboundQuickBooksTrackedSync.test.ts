import { describe, expect, it, vi } from 'vitest';
import { readQuickBooksInvoices, type QuickBooksConnection } from '../services/outboundQuickBooksSync';

const now = new Date('2026-09-14T16:00:00Z');
const connection: QuickBooksConnection = { business_id:'fixture-business', realm_id:'12345', company_name:'Fixture LLC', environment:'sandbox', connected_account_id:'ca_fixture', connection_owner_id:'fixture-owner', timezone:'America/New_York', verified_at:now.toISOString(), status:'active', source_country:'US' };
const invoice = (id:string, balance=100) => ({ Id:id, DocNumber:`INV-${id}`, CustomerRef:{value:id}, Balance:balance, TotalAmt:100, CurrencyRef:{value:'USD'}, TxnDate:'2026-08-01', DueDate:'2026-08-30', Line:[{DetailType:'SalesItemLineDetail',SalesItemLineDetail:{ItemRef:{name:'Category 1'},ServiceDate:'2026-07-30'}}] });
const customer = (id:string) => ({ Id:id, Active:true, DisplayName:`Fixture ${id}`, PrimaryPhone:{FreeFormNumber:'2025550199'}, PrimaryEmailAddr:{Address:'fixture@example.com'} });
const ids = (query:string) => [...query.matchAll(/'([A-Za-z0-9_-]+)'/g)].map(m=>m[1]);

function source(open:ReturnType<typeof invoice>[], tracked:ReturnType<typeof invoice>[]=[], consumer=false) {
  return vi.fn(async (_tool:string,args:Record<string,unknown>) => {
    const query=String(args.query);
    const start=Number(query.match(/STARTPOSITION (\d+)/)?.[1]);
    const limit=Number(query.match(/MAXRESULTS (\d+)/)?.[1]);
    if (consumer) expect(limit).toBe(10);
    if (query.startsWith("SELECT * FROM Invoice WHERE Balance > '0'")) {
      const values=open.slice(start-1,start-1+limit);
      return {QueryResponse:{Invoice:values,startPosition:start,maxResults:values.length}};
    }
    if (query.startsWith('SELECT * FROM Invoice WHERE Id IN')) {
      const values=tracked.filter(i=>ids(query).includes(i.Id));
      return {QueryResponse:{Invoice:values,startPosition:1,maxResults:values.length}};
    }
    if (query.startsWith('SELECT * FROM Customer WHERE Id IN')) {
      const values=ids(query).map(customer);
      return {QueryResponse:{Customer:values,startPosition:1,maxResults:values.length}};
    }
    throw new Error('Unbounded or unsupported test query');
  });
}

describe('open and tracked QuickBooks synchronization',()=>{
  it('reads new/open balances and exact previously tracked paid invoices without loading history',async()=>{
    const execute=source([invoice('1',25)],[invoice('2',0)]);
    const result=await readQuickBooksInvoices(execute,connection,now,['1','2','2']);
    expect(result.rows.map(r=>[r.provider_invoice_id,r.source_balance_cents])).toEqual([['1',2500],['2',0]]);
    expect(result.rows[1].block_reasons).toContain('invoice_paid');
    expect(result.rows[1].eligible).toBe(false);
    expect(result.accounting_writes).toBe(false); expect(result.outreach_started).toBe(false);
    const queries=execute.mock.calls.map(c=>String(c[1].query));
    expect(queries.filter(q=>q.startsWith('SELECT * FROM Invoice WHERE Id IN'))).toEqual(["SELECT * FROM Invoice WHERE Id IN ('2') STARTPOSITION 1 MAXRESULTS 50"]);
    expect(queries.every(q=>q.includes(' WHERE '))).toBe(true);
  });

  it('does not infer payment or deletion from a missing tracked invoice',async()=>{
    const execute=source([invoice('1')]);
    await expect(readQuickBooksInvoices(execute,connection,now,['1','2'])).rejects.toMatchObject({code:'tracked_invoice_missing'});
    expect(execute.mock.calls.some(c=>String(c[1].query).startsWith('SELECT * FROM Customer'))).toBe(false);
  });

  it('keeps a tracked invoice outstanding when its exact read still has a balance',async()=>{
    const result=await readQuickBooksInvoices(source([],[invoice('2',15)]),connection,now,['2']);
    expect(result.rows[0].source_balance_cents).toBe(1500);
    expect(result.rows[0].block_reasons).not.toContain('invoice_paid');
  });

  it('uses verified ten-row consumer pages and bounded tracked/customer chunks without skips',async()=>{
    const open=Array.from({length:21},(_,i)=>invoice(String(i+1)));
    const paid=Array.from({length:25},(_,i)=>invoice(String(i+100),0));
    const execute=source(open,paid,true);
    const result=await readQuickBooksInvoices(execute,{...connection,credential_mode:'consumer_mcp'},now,paid.map(i=>i.Id));
    expect(result.counts.fetched).toBe(46);
    const queries=execute.mock.calls.map(c=>String(c[1].query));
    const starts=queries.filter(q=>q.includes("Balance > '0'")).map(q=>Number(q.match(/STARTPOSITION (\d+)/)?.[1]));
    expect(starts).toEqual([1,11,21,22]);
    expect(queries.filter(q=>q.startsWith('SELECT * FROM Invoice WHERE Id IN'))).toHaveLength(3);
    for(const query of queries.filter(q=>q.includes('Id IN'))) expect(ids(query).length).toBeLessThanOrEqual(10);
  });

  it('advances by actual returned rows when a provider returns a smaller page',async()=>{
    const execute=vi.fn()
      .mockResolvedValueOnce({QueryResponse:{Invoice:[invoice('1'),invoice('2')],startPosition:1,maxResults:2}})
      .mockResolvedValueOnce({QueryResponse:{Invoice:[invoice('3')],startPosition:3,maxResults:1}})
      .mockResolvedValueOnce({QueryResponse:{}})
      .mockResolvedValueOnce({QueryResponse:{Customer:['1','2','3'].map(customer)}});
    expect((await readQuickBooksInvoices(execute,connection,now)).counts.fetched).toBe(3);
    expect(execute.mock.calls[1][1].query).toContain('STARTPOSITION 3');
    expect(execute.mock.calls[2][1].query).toContain('STARTPOSITION 4');
  });

  it.each([
    {Invoice:[invoice('1')],startPosition:2,maxResults:1},
    {Invoice:[invoice('1')],startPosition:1,maxResults:2},
    {Invoice:'truncated'},
    {Customer:[customer('1')]},
    {totalCount:3488},
  ])('rejects malformed or inconsistent source page metadata (%j)',async QueryResponse=>{
    await expect(readQuickBooksInvoices(async()=>({QueryResponse}),connection,now)).rejects.toMatchObject({code:'partial_source_response'});
  });

  it('rejects repeated page records before producing a preview',async()=>{
    await expect(readQuickBooksInvoices(async()=>({QueryResponse:{Invoice:[invoice('1')]}}),connection,now)).rejects.toMatchObject({code:'duplicate_source_invoice'});
  });

  it.each([{tracked:[invoice('3',0)]},{tracked:[invoice('2',0),invoice('2',0)]}])('rejects unexpected or duplicated exact tracked results',async ({tracked})=>{
    const execute=vi.fn().mockResolvedValueOnce({QueryResponse:{}}).mockResolvedValueOnce({QueryResponse:{Invoice:tracked}});
    await expect(readQuickBooksInvoices(execute,connection,now,['2'])).rejects.toMatchObject({code:'invalid_source_identity'});
  });

  it('rejects invalid tracked IDs before any provider request',async()=>{
    const execute=vi.fn();
    await expect(readQuickBooksInvoices(execute,connection,now,["2' OR 1=1"])).rejects.toMatchObject({code:'invalid_source_identity'});
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a paid row incorrectly returned by the open-only filter',async()=>{
    await expect(readQuickBooksInvoices(async()=>({QueryResponse:{Invoice:[invoice('1',0)]}}),connection,now)).rejects.toMatchObject({code:'invalid_source_filter'});
  });

  it('quarantines a missing referenced customer instead of inventing contact data',async()=>{
    const execute=vi.fn().mockResolvedValueOnce({QueryResponse:{Invoice:[invoice('1')]}}).mockResolvedValueOnce({QueryResponse:{}}).mockResolvedValueOnce({QueryResponse:{}});
    const result=await readQuickBooksInvoices(execute,connection,now);
    expect(result.rows[0].mapping_valid).toBe(false); expect(result.rows[0].eligible).toBe(false);
    expect(result.rows[0].email).toBeNull(); expect(result.rows[0].phone_number).toBeNull();
  });
});
