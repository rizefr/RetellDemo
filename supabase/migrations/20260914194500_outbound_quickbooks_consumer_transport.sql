-- Choose the credential transport per verified company, never from ambient key availability.
-- Identity values are privately provisioned after account and exact-realm verification.
alter table public.outbound_quickbooks_connections
 add column if not exists credential_mode text not null default 'project_api',
 add column if not exists consumer_account_id text,
 add column if not exists provider_user_id text,
 add column if not exists company_identity_hash text;
alter table public.outbound_quickbooks_connections
 add constraint outbound_quickbooks_credential_mode check (credential_mode in ('project_api','consumer_mcp')),
 add constraint outbound_quickbooks_consumer_identity check (
  credential_mode <> 'consumer_mcp' or (
   consumer_account_id is not null and length(consumer_account_id)>0 and
   provider_user_id is not null and length(provider_user_id)>0 and
   company_identity_hash is not null and company_identity_hash ~ '^[a-f0-9]{64}$'
  )
 );
comment on column public.outbound_quickbooks_connections.company_identity_hash is
 'Fingerprint of independently verified exact-realm CompanyInfo. Native consumer tools do not return realm; CompanyInfo.Id is not realm.';
