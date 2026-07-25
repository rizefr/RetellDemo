begin;

alter table public.landing_page_events
  drop constraint if exists landing_page_events_name,
  drop constraint if exists landing_page_events_variant,
  drop constraint if exists landing_page_events_route,
  drop constraint if exists landing_page_events_variant_route;

alter table public.landing_page_events
  add constraint landing_page_events_name check (
    event_name in (
      'page_view', 'cta_click', 'form_start', 'form_step_complete', 'form_submit',
      'form_success', 'form_error', 'booking_click', 'demo_click'
    )
  ),
  add constraint landing_page_events_variant check (
    variant in ('answer', 'nevermiss', 'pestline', 'hear', 'ready', 'coverage')
  ),
  add constraint landing_page_events_route check (
    route in ('/answer/', '/nevermiss/', '/pestline/', '/hear/', '/ready/', '/coverage/')
  ),
  add constraint landing_page_events_variant_route check (
    (variant = 'answer' and route = '/answer/') or
    (variant = 'nevermiss' and route = '/nevermiss/') or
    (variant = 'pestline' and route = '/pestline/') or
    (variant = 'hear' and route = '/hear/') or
    (variant = 'ready' and route = '/ready/') or
    (variant = 'coverage' and route = '/coverage/')
  );

alter table public.landing_page_leads
  drop constraint if exists landing_page_leads_variant,
  drop constraint if exists landing_page_leads_route,
  drop constraint if exists landing_page_leads_variant_route;

alter table public.landing_page_leads
  add constraint landing_page_leads_variant check (
    variant in ('answer', 'nevermiss', 'pestline', 'hear', 'ready', 'coverage')
  ),
  add constraint landing_page_leads_route check (
    route in ('/answer/', '/nevermiss/', '/pestline/', '/hear/', '/ready/', '/coverage/')
  ),
  add constraint landing_page_leads_variant_route check (
    (variant = 'answer' and route = '/answer/') or
    (variant = 'nevermiss' and route = '/nevermiss/') or
    (variant = 'pestline' and route = '/pestline/') or
    (variant = 'hear' and route = '/hear/') or
    (variant = 'ready' and route = '/ready/') or
    (variant = 'coverage' and route = '/coverage/')
  );

comment on constraint landing_page_events_variant on public.landing_page_events is
  'Current four-funnel variants plus superseded ready and coverage values retained for historical rows.';
comment on constraint landing_page_leads_variant on public.landing_page_leads is
  'Current four-funnel variants plus superseded ready and coverage values retained for historical rows.';

commit;
