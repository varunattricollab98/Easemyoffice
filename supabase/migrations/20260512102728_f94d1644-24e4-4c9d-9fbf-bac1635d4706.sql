-- 1) Enable realtime
ALTER TABLE public.leads REPLICA IDENTITY FULL;
ALTER TABLE public.follow_ups REPLICA IDENTITY FULL;
ALTER TABLE public.lead_activities REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.leads; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.follow_ups; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_activities; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- 2) Admin-only clear
CREATE OR REPLACE FUNCTION public.clear_demo_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can clear demo data';
  END IF;
  DELETE FROM public.lead_activities;
  DELETE FROM public.follow_ups;
  DELETE FROM public.leads;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_demo_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_demo_data() TO authenticated;

-- 3) Admin-only reseed (100 varied leads + multi follow-ups + activity logs)
CREATE OR REPLACE FUNCTION public.seed_demo_leads()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_count integer := 0;
  v_lead record;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can seed demo data';
  END IF;

  v_owner := auth.uid();

  -- Insert 100 leads
  WITH seed AS (
    SELECT
      g AS n,
      (ARRAY['Aarav Sharma','Vivaan Iyer','Aditya Mehta','Vihaan Reddy','Arjun Khanna','Sai Patel','Reyansh Gupta','Krishna Nair','Ishaan Kapoor','Shaurya Joshi',
             'Atharv Singh','Advik Rao','Kabir Bhatia','Anaya Verma','Diya Malhotra','Saanvi Desai','Aadhya Pillai','Myra Chopra','Aaradhya Menon','Ira Jain',
             'Pari Bose','Anika Dutta','Navya Saxena','Riya Agarwal','Kiara Shetty','Rohan Trivedi','Yash Bhatt','Dev Chauhan','Aryan Mishra','Karthik Subramanian'])[1+(g % 30)] AS client,
      (ARRAY['Acme Ventures','Bluestone Labs','Crayon Retail','Dovetail Tech','Evershine Exports','Fintrek Capital','Globe Logistics','Helix Pharma','Indus Foods','Jasper Studio',
             'Kavya Apparel','Luminate AI','Mosaic Health','Nimbus Cloud','Orbit Mobility','Pivotal CRM','Quartz Realty','Ridgeline Auto','Sandstorm Media','Tessera Bio'])[1+(g % 20)] AS company,
      (ARRAY['Bengaluru','Mumbai','Delhi','Hyderabad','Pune','Chennai','Gurgaon','Noida','Ahmedabad','Kolkata'])[1+(g % 10)] AS city,
      (ARRAY['Karnataka','Maharashtra','Delhi','Telangana','Maharashtra','Tamil Nadu','Haryana','Uttar Pradesh','Gujarat','West Bengal'])[1+(g % 10)] AS st,
      (ARRAY['virtual_office','gst_registration','apob','business_registration','iec','trademark','other'])[1+(g % 7)]::service_type AS svc,
      (ARRAY['website','email','whatsapp','indiamart','google_ads','meta_ads','referral','direct_call'])[1+(g % 8)]::lead_source AS src,
      (ARRAY['hot','warm','cold','warm','hot','warm','cold','dead'])[1+(g % 8)]::lead_interest AS intr,
      (ARRAY['new_lead','contacted','interested','documents_pending','quotation_shared','negotiation','payment_pending','payment_received','draft_shared','agreement_signed','completed','renewal_due','lost'])[1+(g % 13)]::lead_stage AS stg,
      (5000 + (g*137 % 45000))::numeric AS budget
    FROM generate_series(1,100) g
  )
  INSERT INTO public.leads
    (client_name, company_name, mobile, alt_mobile, email, city, state, service_required, source, interest, stage, budget,
     assigned_to, created_by, score, intent_flags, notes, next_follow_up_at, last_activity_at, created_at, updated_at)
  SELECT
    client, company,
    '+9198' || lpad((10000000 + n*7919 % 89999999)::text, 8, '0'),
    CASE WHEN n % 4 = 0 THEN '+9197' || lpad((20000000 + n*3517 % 79999999)::text, 8, '0') ELSE NULL END,
    lower(replace(client,' ','.')) || n || '@' || lower(replace(company,' ','')) || '.com',
    city, st, svc, src, intr, stg, budget,
    v_owner, v_owner,
    (n*13 % 100),
    jsonb_build_object('asked_pricing',(n%2=0),'asked_agreement',(n%5=0),'asked_documents',(n%3=0),'ready_for_payment',(n%7=0),'requested_callback',(n%4=0)),
    CASE WHEN n%3=0 THEN 'Client requested callback after 5 PM. Follow up needed.'
         WHEN n%3=1 THEN 'Sent quotation. Awaiting confirmation on pricing.'
         ELSE 'Initial discussion done. Documents shared via email.' END,
    CASE
      WHEN stg IN ('completed','lost') THEN NULL
      WHEN n%4=0 THEN now() - ((n%6+1)||' days')::interval
      WHEN n%4=1 THEN now() + ((n%8)||' hours')::interval
      ELSE now() + ((n%14+1)||' days')::interval
    END,
    now() - ((n%10)||' days')::interval,
    now() - ((n%30)||' days')::interval,
    now() - ((n%30)||' days')::interval
  FROM seed;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- 1-3 follow-ups per lead with varied schedules
  FOR v_lead IN SELECT id, assigned_to, created_by, stage FROM public.leads LOOP
    INSERT INTO public.follow_ups (lead_id, owner_id, action, due_at, status, created_by, note)
    SELECT
      v_lead.id, v_lead.assigned_to,
      (ARRAY['Call to confirm pricing','Send quotation PDF','Share documents checklist','Schedule meeting','Confirm payment receipt','Send agreement draft','Welcome call','Renewal reminder','WhatsApp pricing','Email proposal'])[1 + (abs(hashtext(v_lead.id::text || k::text)) % 10)],
      CASE k
        WHEN 0 THEN now() + ((abs(hashtext(v_lead.id::text)) % 48) - 24 || ' hours')::interval
        WHEN 1 THEN now() + ((abs(hashtext(v_lead.id::text)) % 7 + 1) || ' days')::interval
        ELSE now() + ((abs(hashtext(v_lead.id::text)) % 21 + 7) || ' days')::interval
      END,
      CASE WHEN v_lead.stage IN ('completed','lost') AND k = 0 THEN 'completed'::followup_status ELSE 'pending'::followup_status END,
      v_lead.created_by,
      (ARRAY['Auto-generated reminder','Awaiting client response','Priority follow-up','Decision pending','Routine check-in'])[1 + (abs(hashtext(v_lead.id::text || k::text)) % 5)]
    FROM generate_series(0, 1 + abs(hashtext(v_lead.id::text)) % 3) k;

    -- 2-5 activity / communication log entries per lead
    INSERT INTO public.lead_activities (lead_id, actor_id, type, title, body, payload, created_at)
    SELECT
      v_lead.id, v_lead.assigned_to,
      (ARRAY['call_logged','email_sent','whatsapp_sent','note_added','stage_changed']::activity_type[])[1 + (abs(hashtext(v_lead.id::text || k::text)) % 5)],
      (ARRAY['Outbound call','Quotation email','WhatsApp message','Internal note','Stage updated'])[1 + (abs(hashtext(v_lead.id::text || k::text)) % 5)],
      (ARRAY['Discussed pricing and timelines. Will share quote.',
             'Sent quotation with detailed breakdown.',
             'Shared agreement draft on WhatsApp.',
             'Client busy this week, retry next Monday.',
             'Moved to negotiation stage.'])[1 + (abs(hashtext(v_lead.id::text || k::text)) % 5)],
      jsonb_build_object('duration_sec', 60 + abs(hashtext(v_lead.id::text||k::text)) % 600),
      now() - ((abs(hashtext(v_lead.id::text||k::text)) % 30) || ' days')::interval
    FROM generate_series(0, 1 + abs(hashtext(v_lead.id::text)) % 4) k;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_demo_leads() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_demo_leads() TO authenticated;